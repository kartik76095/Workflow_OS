import { useState, useEffect } from 'react';
import axios from 'axios';
import { Users as UsersIcon, Shield, UserCheck, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';

// Fix API URL to prevent "undefined" errors
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function Users({ user: currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(res.data.users || []);
    } catch (error) {
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (userId, newRole) => {
    const token = localStorage.getItem('token');
    try {
      await axios.patch(
        `${API}/users/${userId}/role`,
        { role: newRole },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('User role updated');
      fetchUsers();
    } catch (error) {
      toast.error('Failed to update user role');
    }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm("WARNING: Are you sure you want to permanently delete this user?")) {
      return;
    }
    
    const token = localStorage.getItem('token');
    try {
      await axios.delete(`${API}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('User deleted successfully!');
      fetchUsers(); 
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'super_admin': return Shield;
      case 'admin': return UserCheck;
      case 'user': return UsersIcon;
      case 'guest': return Eye;
      default: return UsersIcon;
    }
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'super_admin': return { bg: '#fed7d7', color: '#c53030' };
      case 'admin': return { bg: '#bee3f8', color: '#2c5282' };
      case 'user': return { bg: '#c6f6d5', color: '#22543d' };
      case 'guest': return { bg: '#e2e8f0', color: '#4a5568' };
      default: return { bg: '#eff2f5', color: '#718096' };
    }
  };

  // Safe check for currentUser
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'super_admin')) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="p-8 text-center">
          <Shield className="w-16 h-16 mx-auto mb-4 text-[#f56565]" />
          <h3 className="text-lg font-semibold text-[#1a202c] mb-2">Access Denied</h3>
          <p className="text-[#718096]">You don't have permission to view this page.</p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0a69a7]"></div>
      </div>
    );
  }

  return (
    <div data-testid="users-page" className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          User Management
        </h1>
        <p className="text-[#718096] mt-2">Manage user roles and permissions</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {users.map((user) => {
          const RoleIcon = getRoleIcon(user.role);
          const roleColors = getRoleBadgeColor(user.role);
          // Can edit if you are super_admin AND the target user is not yourself
          const canEditRole = currentUser.role === 'super_admin' && user.id !== currentUser.id;
          
          // Safe Name Handling for Synced Users
          const displayName = user.full_name || user.email || "Unknown User";
          const initial = displayName.charAt(0).toUpperCase();
          const isSynced = user.source === 'external_sync';

          return (
            <Card key={user.id} className="p-6 bg-white border border-[#e2e8f0] hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-[#70bae7] flex items-center justify-center text-white font-semibold text-lg mr-4 relative">
                    {initial}
                    {/* Synced User Indicator */}
                    {isSynced && (
                      <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5" title="Synced from External DB">
                        <RefreshCw className="w-4 h-4 text-[#0a69a7]" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[#1a202c]">{displayName}</h3>
                      {isSynced && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded border border-blue-100">Synced</span>}
                    </div>
                    <p className="text-sm text-[#718096]">{user.email}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                       {user.last_login ? `Last seen: ${new Date(user.last_login).toLocaleDateString()}` : 'Never logged in'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div
                    className="flex items-center px-3 py-2 rounded-lg"
                    style={{ backgroundColor: roleColors.bg }}
                  >
                    <RoleIcon className="w-4 h-4 mr-2" style={{ color: roleColors.color }} />
                    <span className="text-sm font-medium capitalize" style={{ color: roleColors.color }}>
                      {user.role.replace('_', ' ')}
                    </span>
                  </div>

                  {canEditRole && (
                    <>
                      <Select
                        value={user.role}
                        onValueChange={(newRole) => updateUserRole(user.id, newRole)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="guest">Guest</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => deleteUser(user.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2"
                        title="Permanently Delete User"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Role Legend Card */}
      {currentUser.role === 'super_admin' && (
        <Card className="p-6 bg-[#eff2f5] border border-[#70bae7]">
          <h3 className="text-sm font-semibold text-[#1a202c] mb-3">Role Permissions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-medium text-[#c53030] mb-2">Super Admin</p>
              <p className="text-xs text-[#718096]">Full system access</p>
            </div>
            <div>
              <p className="font-medium text-[#2c5282] mb-2">Admin</p>
              <p className="text-xs text-[#718096]">Manage tasks & workflows</p>
            </div>
            <div>
              <p className="font-medium text-[#22543d] mb-2">User</p>
              <p className="text-xs text-[#718096]">Execute & update tasks</p>
            </div>
            <div>
              <p className="font-medium text-[#4a5568] mb-2">Guest</p>
              <p className="text-xs text-[#718096]">Read-only access</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}