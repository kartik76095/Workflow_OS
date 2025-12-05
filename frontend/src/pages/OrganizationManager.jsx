import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Building2, User, KeyRound, CheckCircle2, ShieldAlert, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function OrganizationManager({ user }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Password Reset State
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [newCredentials, setNewCredentials] = useState(null);

  useEffect(() => {
    if (user?.role === 'super_admin') {
      fetchTenants();
    }
  }, [user]);

  const fetchTenants = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API}/admin/tenants`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTenants(res.data.tenants || []);
    } catch (error) {
      toast.error("Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedAdmin) return;
    
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API}/admin/users/${selectedAdmin.id}/reset-password`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNewCredentials(res.data);
      toast.success("Password reset successfully");
    } catch (error) {
      toast.error("Failed to reset password");
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  // Filter Logic
  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.admins.some(a => a.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (user?.role !== 'super_admin') return <div className="p-8 text-center text-gray-500">Access Denied</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Organization Manager
          </h1>
          <p className="text-[#718096] mt-1">Monitor tenants and manage admin access.</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <Input 
            placeholder="Search organizations..." 
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-6">
        {filteredTenants.map((org) => (
          <Card key={org.id} className="p-6 border-l-4 border-l-[#0a69a7] shadow-sm hover:shadow-md transition-shadow">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              
              {/* Org Details */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-5 h-5 text-[#0a69a7]" />
                  <h3 className="text-xl font-bold text-gray-900">{org.name}</h3>
                  {org.is_active ? 
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge> : 
                    <Badge variant="destructive">Inactive</Badge>
                  }
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  <p>ID: <span className="font-mono text-xs">{org.id}</span></p>
                  <p>Created: {new Date(org.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Admins List */}
              <div className="flex-1 border-l pl-6 border-gray-100">
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> Organization Admins
                </h4>
                
                <div className="space-y-3">
                  {org.admins.length === 0 ? (
                    <p className="text-sm text-red-400 italic">No admins assigned!</p>
                  ) : (
                    org.admins.map(admin => (
                      <div key={admin.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
                            {admin.full_name?.charAt(0) || 'A'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{admin.full_name}</p>
                            <p className="text-xs text-gray-500">{admin.email}</p>
                          </div>
                        </div>
                        
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 h-8 text-xs"
                          onClick={() => {
                            setSelectedAdmin(admin);
                            setNewCredentials(null);
                            setResetDialogOpen(true);
                          }}
                        >
                          <KeyRound className="w-3 h-3 mr-1.5" /> Reset Pass
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </Card>
        ))}
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              This will invalidate the current password for <b>{selectedAdmin?.email}</b>.
            </DialogDescription>
          </DialogHeader>

          {!newCredentials ? (
            <div className="py-4 space-y-4">
              <div className="p-3 bg-yellow-50 text-yellow-800 text-sm rounded border border-yellow-200 flex gap-2">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <p>The user will be forced to set a new custom password immediately upon their next login.</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleResetPassword}>Confirm Reset</Button>
              </div>
            </div>
          ) : (
            <div className="py-4 space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex flex-col items-center justify-center text-center space-y-2 text-green-600">
                <CheckCircle2 className="w-12 h-12" />
                <p className="font-bold">Password Reset Successful</p>
              </div>
              
              <div className="bg-slate-100 p-4 rounded-lg space-y-2 border border-slate-200">
                <p className="text-xs text-slate-500 uppercase font-bold">Temporary Password</p>
                <div className="flex items-center justify-between bg-white p-2 rounded border">
                  <code className="font-mono font-bold text-lg">{newCredentials.temp_password}</code>
                  <Button size="sm" variant="ghost" onClick={() => copyToClipboard(newCredentials.temp_password)}>
                    Copy
                  </Button>
                </div>
              </div>
              
              <Button className="w-full" onClick={() => setResetDialogOpen(false)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}