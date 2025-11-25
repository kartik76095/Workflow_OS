import { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Search, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';

const API = "http://localhost:8000/api";

export default function AuditLogs({ user }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedLogs, setExpandedLogs] = useState(new Set());
  const [filterAction, setFilterAction] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchAuditLogs();
  }, [filterAction]);

  const fetchAuditLogs = async () => {
    const token = localStorage.getItem('token');
    try {
      const params = {};
      if (filterAction && filterAction !== 'all') {
        params.action = filterAction;
      }
      const res = await axios.get(`${API}/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setLogs(res.data.logs || []);
    } catch (error) {
      if (error.response?.status === 403) {
        toast.error('Audit logs are only accessible to administrators');
      } else {
        toast.error('Failed to fetch audit logs');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleLogExpansion = (logId) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(logId)) {
      newExpanded.delete(logId);
    } else {
      newExpanded.add(logId);
    }
    setExpandedLogs(newExpanded);
  };

  const getActionColor = (action) => {
    if (action.includes('CREATE')) return 'text-green-600 bg-green-50';
    if (action.includes('UPDATE')) return 'text-blue-600 bg-blue-50';
    if (action.includes('DELETE')) return 'text-red-600 bg-red-50';
    if (action.includes('LOGIN')) return 'text-purple-600 bg-purple-50';
    if (action.includes('WORKFLOW')) return 'text-indigo-600 bg-indigo-50';
    return 'text-gray-600 bg-gray-50';
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const renderChanges = (changes) => {
    if (!changes || Object.keys(changes).length === 0) {
      return <span className="text-gray-400 text-sm italic">No changes recorded</span>;
    }

    return (
      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
        <h5 className="text-xs font-semibold text-gray-700 mb-2">Changes:</h5>
        <pre className="text-xs text-gray-600 overflow-x-auto">
          {JSON.stringify(changes, null, 2)}
        </pre>
      </div>
    );
  };

  const filteredLogs = logs.filter((log) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(searchLower) ||
      log.target_resource?.toLowerCase().includes(searchLower) ||
      log.actor_id?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <Shield className="inline w-8 h-8 mr-3 text-[#0a69a7]" />
            Audit Logs
          </h1>
          <p className="text-[#718096] mt-2">Immutable trail of all critical system actions</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#718096]" />
          <Input
            placeholder="Search by action, resource, or actor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-48">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="TASK_CREATE">Task Create</SelectItem>
            <SelectItem value="TASK_UPDATE">Task Update</SelectItem>
            <SelectItem value="TASK_DELETE">Task Delete</SelectItem>
            <SelectItem value="WORKFLOW_START">Workflow Start</SelectItem>
            <SelectItem value="WORKFLOW_PROGRESS">Workflow Progress</SelectItem>
            <SelectItem value="WORKFLOW_REWIND">Workflow Rewind</SelectItem>
            <SelectItem value="USER_REGISTER">User Register</SelectItem>
            <SelectItem value="USER_ROLE_UPDATE">User Role Update</SelectItem>
            <SelectItem value="WEBHOOK_RECEIVED">Webhook Received</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Audit Logs Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0a69a7]"></div>
        </div>
      ) : filteredLogs.length === 0 ? (
        <Card className="p-12 text-center">
          <Shield className="w-16 h-16 mx-auto mb-4 text-[#718096]" />
          <h3 className="text-lg font-semibold text-[#1a202c] mb-2">No audit logs found</h3>
          <p className="text-[#718096]">
            {searchQuery || filterAction !== 'all'
              ? 'Try adjusting your filters'
              : 'Audit logs will appear here as actions are performed'}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#eff2f5] border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#1a202c] uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#1a202c] uppercase tracking-wider">
                    Actor
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#1a202c] uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#1a202c] uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[#1a202c] uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#e2e8f0]">
                {filteredLogs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className="hover:bg-[#eff2f5] transition-colors cursor-pointer"
                      onClick={() => toggleLogExpansion(log.id)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[#4a5568]">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 rounded-full bg-[#0a69a7] text-white flex items-center justify-center text-xs font-medium">
                            {log.actor_id?.substring(0, 2).toUpperCase() || 'SY'}
                          </div>
                          <span className="ml-2 text-sm text-[#1a202c] font-medium">
                            {log.actor_id || 'System'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[#4a5568] font-mono">
                        {log.target_resource}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[#718096]">
                        {expandedLogs.has(log.id) ? (
                          <ChevronDown className="w-4 h-4 inline" />
                        ) : (
                          <ChevronRight className="w-4 h-4 inline" />
                        )}
                        <span className="ml-2">
                          {Object.keys(log.changes || {}).length > 0 ? 'View changes' : 'No changes'}
                        </span>
                      </td>
                    </tr>
                    {expandedLogs.has(log.id) && (
                      <tr>
                        <td colSpan={5} className="px-6 py-4 bg-[#f7fafc]">
                          <div className="space-y-2">
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <div>
                                <h5 className="text-xs font-semibold text-gray-700 mb-2">Metadata:</h5>
                                <pre className="text-xs text-gray-600 overflow-x-auto p-2 bg-white rounded">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                            {renderChanges(log.changes)}
                            {log.ip_address && (
                              <p className="text-xs text-gray-500">
                                <strong>IP Address:</strong> {log.ip_address}
                              </p>
                            )}
                            {log.user_agent && (
                              <p className="text-xs text-gray-500">
                                <strong>User Agent:</strong> {log.user_agent}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-[#eff2f5] px-6 py-3 border-t border-[#e2e8f0]">
            <p className="text-sm text-[#718096]">
              Showing <span className="font-semibold text-[#1a202c]">{filteredLogs.length}</span> audit log(s)
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
