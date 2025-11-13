import { useState, useEffect } from 'react';
import axios from 'axios';
import { Users as UsersIcon, Shield, UserCheck, Eye } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
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

  const getRoleIcon = (role) => {
    switch (role) {
      case 'super_admin':
        return Shield;
      case 'admin':
        return UserCheck;
      case 'user':
        return UsersIcon;
      case 'guest':
        return Eye;
      default:
        return UsersIcon;
    }
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'super_admin':
        return { bg: '#fed7d7', color: '#c53030' };
      case 'admin':
        return { bg: '#bee3f8', color: '#2c5282' };
      case 'user':
        return { bg: '#c6f6d5', color: '#22543d' };
      case 'guest':
        return { bg: '#e2e8f0', color: '#4a5568' };
      default:
        return { bg: '#eff2f5', color: '#718096' };
    }
  };

  if (currentUser?.role !== 'admin' && currentUser?.role !== 'super_admin') {
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
          const canEditRole = currentUser.role === 'super_admin' && user.id !== currentUser.id;

          return (
            <Card key={user.id} className="p-6 bg-white border border-[#e2e8f0] hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-[#70bae7] flex items-center justify-center text-white font-semibold text-lg mr-4">
                    {user.full_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1a202c]">{user.full_name}</h3>
                    <p className="text-sm text-[#718096]">{user.email}</p>
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
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

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
