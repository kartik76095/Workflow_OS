import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { Loader2, Lock, AlertTriangle } from 'lucide-react';

// ✅ Fix API URL
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function Login({ setUser }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  // ✅ NEW: State to handle forced password change
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [tempToken, setTempToken] = useState(''); // Store token temporarily while changing password

  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await axios.post(`${API}/auth/login`, { email, password });
      const userData = res.data.user;
      const token = res.data.access_token;

      // ✅ CHECK: Does this user need to change their password?
      if (userData.must_change_password) {
        setTempToken(token); // Save token so we can use it to update password
        setRequirePasswordChange(true); // Switch UI to "Change Password" mode
        toast.info("Security Alert: You must update your password to continue.");
      } else {
        // Normal Login
        localStorage.setItem('token', token);
        setUser(userData);
        toast.success('Welcome back!');
        navigate('/dashboard');
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
        toast.error("Password must be at least 8 characters");
        return;
    }
    setLoading(true);

    try {
        // 1. Call the API to change the password
        await axios.post(
            `${API}/auth/change-password`, 
            { new_password: newPassword },
            { headers: { Authorization: `Bearer ${tempToken}` } }
        );
        
        // 2. If we get here, it worked! (200 OK)
        // Save the token so we are logged in
        localStorage.setItem('token', tempToken);
        
        // 3. Skip the extra "/me" check that was causing the 422 error
        // The App.js will fetch the user data automatically when we hit the dashboard.
        toast.success("Password updated successfully!");
        navigate('/dashboard');

    } catch (error) {
        // Only show error if the actual update failed
        toast.error(error.response?.data?.detail || "Failed to update password");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#eff2f5] to-[#70bae7]/10">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: '#0a69a7', fontFamily: 'Space Grotesk, sans-serif' }}>
            Katalusis
          </h1>
          <p className="text-[#718096] mt-2">
            {requirePasswordChange ? "Security Update Required" : "Sign in to your workflow dashboard"}
          </p>
        </div>

        {/* ✅ MODE 1: FORCE PASSWORD CHANGE */}
        {requirePasswordChange ? (
            <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                        Your account was created via sync. Please set a secure password to activate your account.
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-[#1a202c] mb-2">New Password</label>
                    <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new secure password"
                        required
                        minLength={8}
                    />
                </div>
                <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                    style={{ backgroundColor: '#0a69a7' }}
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Password & Login'}
                </Button>
            </form>
        ) : (
            /* ✅ MODE 2: NORMAL LOGIN */
            <form onSubmit={handleLogin} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-[#1a202c] mb-2">Email</label>
                <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-[#1a202c] mb-2">Password</label>
                <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                />
            </div>

            <Button
                type="submit"
                disabled={loading}
                className="w-full"
                style={{ backgroundColor: '#0a69a7' }}
            >
                {loading ? (
                <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                </>
                ) : (
                'Sign In'
                )}
            </Button>
            </form>
        )}

        {!requirePasswordChange && (
            <p className="text-center text-sm text-[#718096] mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-[#0a69a7] font-medium hover:underline">
                Create one
            </Link>
            </p>
        )}
      </div>
    </div>
  );
}