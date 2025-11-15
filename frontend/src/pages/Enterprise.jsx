import { useState, useEffect } from 'react';
import axios from 'axios';
import { Building2, Database, Users, Shield, Plus, TestTube, Sync, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Enterprise({ user }) {
  const [organization, setOrganization] = useState(null);
  const [connections, setConnections] = useState([]);
  const [ssoConfigs, setSsoConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createConnectionOpen, setCreateConnectionOpen] = useState(false);
  const [createSSOOpen, setCreateSSOOpen] = useState(false);

  // New connection form
  const [newConnection, setNewConnection] = useState({
    name: '',
    connection_type: 'postgresql',
    host: '',
    port: 5432,
    database: '',
    username: '',
    password: '',
    ssl_enabled: false,
    sync_users: false
  });

  // SSO form
  const [newSSO, setNewSSO] = useState({
    provider: 'saml',
    provider_name: '',
    config: {}
  });

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'super_admin') {
      fetchOrganizationData();
    }
  }, [user]);

  const fetchOrganizationData = async () => {
    const token = localStorage.getItem('token');
    try {
      const [orgRes, connectionsRes, ssoRes] = await Promise.all([
        axios.get(`${API}/organizations/current`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/organizations/database-connections`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/organizations/sso-config`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      
      setOrganization(orgRes.data);
      setConnections(connectionsRes.data.connections || []);
      setSsoConfigs(ssoRes.data.sso_configs || []);
    } catch (error) {
      console.error('Failed to fetch organization data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createConnection = async () => {
    const token = localStorage.getItem('token');
    try {
      await axios.post(`${API}/organizations/database-connections`, newConnection, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Database connection created successfully!');
      setCreateConnectionOpen(false);
      setNewConnection({
        name: '', connection_type: 'postgresql', host: '', port: 5432,
        database: '', username: '', password: '', ssl_enabled: false, sync_users: false
      });
      fetchOrganizationData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create connection');
    }
  };

  const testConnection = async (connectionId) => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.post(`${API}/organizations/database-connections/${connectionId}/test`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.status === 'success') {
        toast.success('Connection test successful!');
      } else {
        toast.error(`Connection test failed: ${res.data.message}`);
      }
    } catch (error) {
      toast.error('Connection test failed');
    }
  };

  const syncUsers = async (connectionId) => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.post(`${API}/organizations/database-connections/${connectionId}/sync-users`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.status === 'success') {
        toast.success(`Successfully synced ${res.data.synced_count} users`);
      } else {
        toast.error(`User sync failed: ${res.data.message}`);
      }
    } catch (error) {
      toast.error('User sync failed');
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="p-8 text-center">
          <Shield className="w-16 h-16 mx-auto mb-4 text-[#f56565]" />
          <h3 className="text-lg font-semibold text-[#1a202c] mb-2">Access Denied</h3>
          <p className="text-[#718096]">Only organization admins can access enterprise features.</p>
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
    <div data-testid="enterprise-page" className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Enterprise Integration
        </h1>
        <p className="text-[#718096] mt-2">Connect Katalusis to your existing systems</p>
      </div>

      {/* Organization Info */}
      {organization && (
        <Card className="p-6 bg-gradient-to-r from-[#70bae7]/10 to-[#0a69a7]/5">
          <div className="flex items-center">
            <Building2 className="w-12 h-12 text-[#0a69a7] mr-4" />
            <div>
              <h2 className="text-2xl font-bold text-[#1a202c]">{organization.name}</h2>
              <p className="text-[#718096]">Subdomain: {organization.subdomain}</p>
              <p className="text-sm text-[#48bb78] mt-1">✅ Organization Active</p>
            </div>
          </div>
        </Card>
      )}

      {/* Database Connections */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Database className="w-6 h-6 text-[#0a69a7] mr-3" />
            <h3 className="text-xl font-semibold text-[#1a202c]">Database Connections</h3>
          </div>
          <Dialog open={createConnectionOpen} onOpenChange={setCreateConnectionOpen}>
            <DialogTrigger asChild>
              <Button style={{ backgroundColor: '#0a69a7' }}>
                <Plus className="w-4 h-4 mr-2" />
                Add Connection
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Database Connection</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Connection Name</label>
                    <Input
                      value={newConnection.name}
                      onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                      placeholder="Production Database"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Database Type</label>
                    <Select value={newConnection.connection_type} onValueChange={(val) => setNewConnection({ ...newConnection, connection_type: val, port: val === 'postgresql' ? 5432 : val === 'mysql' ? 3306 : 1433 })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="postgresql">PostgreSQL</SelectItem>
                        <SelectItem value="mysql">MySQL</SelectItem>
                        <SelectItem value="sql_server">SQL Server</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Host</label>
                    <Input
                      value={newConnection.host}
                      onChange={(e) => setNewConnection({ ...newConnection, host: e.target.value })}
                      placeholder="localhost"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Port</label>
                    <Input
                      type="number"
                      value={newConnection.port}
                      onChange={(e) => setNewConnection({ ...newConnection, port: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Database Name</label>
                  <Input
                    value={newConnection.database}
                    onChange={(e) => setNewConnection({ ...newConnection, database: e.target.value })}
                    placeholder="mydatabase"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Username</label>
                    <Input
                      value={newConnection.username}
                      onChange={(e) => setNewConnection({ ...newConnection, username: e.target.value })}
                      placeholder="dbuser"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Password</label>
                    <Input
                      type="password"
                      value={newConnection.password}
                      onChange={(e) => setNewConnection({ ...newConnection, password: e.target.value })}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={newConnection.ssl_enabled}
                      onChange={(e) => setNewConnection({ ...newConnection, ssl_enabled: e.target.checked })}
                    />
                    <span className="text-sm">Enable SSL</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={newConnection.sync_users}
                      onChange={(e) => setNewConnection({ ...newConnection, sync_users: e.target.checked })}
                    />
                    <span className="text-sm">Sync Users</span>
                  </label>
                </div>
                <Button onClick={createConnection} className="w-full" style={{ backgroundColor: '#0a69a7' }}>
                  Create Connection
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {connections.length === 0 ? (
          <div className="text-center py-8">
            <Database className="w-16 h-16 mx-auto mb-4 text-[#718096]" />
            <h4 className="text-lg font-semibold text-[#1a202c] mb-2">No Database Connections</h4>
            <p className="text-[#718096] mb-4">Connect to your existing databases to sync users and workflows</p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((conn) => (
              <div key={conn.id} className="p-4 border border-[#e2e8f0] rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Database className="w-8 h-8 text-[#0a69a7] mr-3" />
                    <div>
                      <h4 className="font-semibold text-[#1a202c]">{conn.name}</h4>
                      <p className="text-sm text-[#718096]">
                        {conn.connection_type.toUpperCase()} - {conn.host}:{conn.port}/{conn.database}
                      </p>
                      <div className="flex items-center mt-1">
                        {conn.sync_status === 'success' && <CheckCircle2 className="w-4 h-4 text-[#48bb78] mr-1" />}
                        {conn.sync_status === 'error' && <XCircle className="w-4 h-4 text-[#f56565] mr-1" />}
                        {conn.sync_status === 'never_synced' && <Clock className="w-4 h-4 text-[#718096] mr-1" />}
                        <span className="text-xs text-[#718096] capitalize">{conn.sync_status.replace('_', ' ')}</span>
                        {conn.last_sync && (
                          <span className="text-xs text-[#718096] ml-2">Last: {new Date(conn.last_sync).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testConnection(conn.id)}
                    >
                      <TestTube className="w-4 h-4 mr-1" />
                      Test
                    </Button>
                    {conn.sync_users && (
                      <Button
                        size="sm"
                        onClick={() => syncUsers(conn.id)}
                        style={{ backgroundColor: '#48bb78' }}
                      >
                        <Sync className="w-4 h-4 mr-1" />
                        Sync Users
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SSO Configuration */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Shield className="w-6 h-6 text-[#0a69a7] mr-3" />
            <h3 className="text-xl font-semibold text-[#1a202c]">Single Sign-On</h3>
          </div>
          <Button variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Configure SSO
          </Button>
        </div>

        {ssoConfigs.length === 0 ? (
          <div className="text-center py-8">
            <Shield className="w-16 h-16 mx-auto mb-4 text-[#718096]" />
            <h4 className="text-lg font-semibold text-[#1a202c] mb-2">SSO Not Configured</h4>
            <p className="text-[#718096] mb-4">Set up SAML, OAuth, or Active Directory integration</p>
            <div className="flex justify-center space-x-2">
              <Button variant="outline" size="sm">SAML 2.0</Button>
              <Button variant="outline" size="sm">OAuth 2.0</Button>
              <Button variant="outline" size="sm">Active Directory</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {ssoConfigs.map((sso) => (
              <div key={sso.id} className="p-4 border border-[#e2e8f0] rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-[#1a202c]">{sso.provider_name}</h4>
                    <p className="text-sm text-[#718096]">{sso.provider.toUpperCase()} Integration</p>
                    <span className="text-xs text-[#48bb78]">✅ Active</span>
                  </div>
                  <Button size="sm" variant="outline">
                    Configure
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
