import { useState } from 'react';
import axios from 'axios';
// ✅ FIX: Added AlertCircle to imports
import { Building2, Mail, User, CheckCircle2, Copy, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function OnboardTenant({ user }) {
  const [formData, setFormData] = useState({
    company_name: '',
    admin_name: '',
    admin_email: ''
  });
  const [loading, setLoading] = useState(false);
  const [successData, setSuccessData] = useState(null);

  // Access Control: Only Super Admin
  if (user?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center text-gray-500">
          <Building2 className="w-12 h-12 mx-auto mb-2 opacity-20" />
          <h3 className="text-lg font-semibold">Access Restricted</h3>
          <p className="text-sm">Only Super Admins can onboard new tenants.</p>
        </div>
      </div>
    );
  }

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccessData(null);

    const token = localStorage.getItem('token');
    try {
      const res = await axios.post(
        `${API}/admin/onboard-tenant`,
        formData,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setSuccessData(res.data);
      toast.success('Organization onboarded successfully!');
      setFormData({ company_name: '', admin_name: '', admin_email: '' });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to onboard tenant');
    } finally {
      setLoading(false);
    }
  };

  const copyPassword = () => {
    if (successData?.admin_user?.temp_password) {
      navigator.clipboard.writeText(successData.admin_user.temp_password);
      toast.success('Password copied to clipboard');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Onboard New Tenant
        </h1>
        <p className="text-[#718096] mt-2">Provision a new organization workspace and admin account.</p>
      </div>

      <Card className="p-6 border-t-4 border-t-[#0a69a7]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Organization Name
            </label>
            <Input
              name="company_name"
              value={formData.company_name}
              onChange={handleChange}
              placeholder="e.g. Acme Corp"
              required
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <User className="w-4 h-4" /> Admin Name
              </label>
              <Input
                name="admin_name"
                value={formData.admin_name}
                onChange={handleChange}
                placeholder="e.g. Jane Doe"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Mail className="w-4 h-4" /> Admin Email
              </label>
              <Input
                name="admin_email"
                type="email"
                value={formData.admin_email}
                onChange={handleChange}
                placeholder="admin@acmecorp.com"
                required
                disabled={loading}
              />
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full bg-[#0a69a7] hover:bg-[#085d96]"
            disabled={loading}
          >
            {loading ? 'Provisioning...' : 'Create Organization'}
          </Button>
        </form>
      </Card>

      {/* Success Card */}
      {successData && (
        <Card className="p-6 bg-green-50 border border-green-200 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-green-100 rounded-full">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-green-800">Onboarding Complete!</h3>
              <p className="text-sm text-green-700 mt-1">
                The organization has been created. Please securely share these credentials with the new admin.
              </p>
              
              <div className="mt-4 bg-white p-4 rounded border border-green-200 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Login Email:</span>
                  <span className="font-medium font-mono">{successData.admin_user.email}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Temp Password:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold bg-gray-100 px-2 py-1 rounded text-gray-800">
                      {successData.admin_user.temp_password}
                    </span>
                    <Button size="sm" variant="ghost" onClick={copyPassword} className="h-7 w-7 p-0">
                      <Copy className="w-4 h-4 text-gray-500" />
                    </Button>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex items-center gap-2 text-xs text-green-800">
                <AlertCircle className="w-4 h-4" />
                User will be prompted to change password on first login.
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}