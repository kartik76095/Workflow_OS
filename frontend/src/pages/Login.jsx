import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Login({ setUser }) {
  const [email, setEmail] = useState('admin@katalusis.com');
  const [password, setPassword] = useState('Admin@123');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await axios.post(`${API}/auth/login`, { email, password });
      localStorage.setItem('token', res.data.access_token);
      setUser(res.data.user);
      toast.success('Login successful!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#eff2f5] to-[#70bae7]/10">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-xl" data-testid="login-form">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold" style={{ color: '#0a69a7', fontFamily: 'Space Grotesk, sans-serif' }}>
            Katalusis
          </h1>
          <p className="text-[#718096] mt-2">Sign in to your workflow dashboard</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1a202c] mb-2">Email</label>
            <Input
              data-testid="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@katalusis.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1a202c] mb-2">Password</label>
            <Input
              data-testid="password-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <Button
            data-testid="login-button"
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

        <p className="text-center text-sm text-[#718096] mt-6">
          Don't have an account?{' '}
          <Link to="/register" className="text-[#0a69a7] font-medium hover:underline">
            Register here
          </Link>
        </p>

        <div className="mt-6 p-4 bg-[#eff2f5] rounded-lg">
          <p className="text-xs text-[#4a5568] font-medium">Demo Credentials:</p>
          <p className="text-xs text-[#718096] mt-1">Email: admin@katalusis.com</p>
          <p className="text-xs text-[#718096]">Password: Admin@123</p>
        </div>
      </div>
    </div>
  );
}
