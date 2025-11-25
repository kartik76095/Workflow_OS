import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart3, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';

const API = "http://localhost:8000/api";

export default function Analytics() {
  const [analytics, setAnalytics] = useState(null);
  const [period, setPeriod] = useState('week');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  const fetchAnalytics = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/analytics/dashboard?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAnalytics(res.data);
    } catch (error) {
      toast.error('Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0a69a7]"></div>
      </div>
    );
  }

  const metrics = analytics?.metrics || {};

  return (
    <div data-testid="analytics-page" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Analytics
          </h1>
          <p className="text-[#718096] mt-2">Insights and performance metrics</p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-4">
            <BarChart3 className="w-8 h-8 text-[#0a69a7]" />
            <span className="text-xs font-medium text-[#48bb78] flex items-center">
              <TrendingUp className="w-4 h-4 mr-1" />
              +12%
            </span>
          </div>
          <h3 className="text-sm font-medium text-[#718096] mb-1">Total Tasks</h3>
          <p className="text-3xl font-bold text-[#1a202c]">{metrics.total_tasks || 0}</p>
        </Card>

        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-4">
            <Activity className="w-8 h-8 text-[#48bb78]" />
            <span className="text-xs font-medium text-[#48bb78] flex items-center">
              <TrendingUp className="w-4 h-4 mr-1" />
              +8%
            </span>
          </div>
          <h3 className="text-sm font-medium text-[#718096] mb-1">Completion Rate</h3>
          <p className="text-3xl font-bold text-[#1a202c]">{metrics.completion_rate?.toFixed(1) || 0}%</p>
        </Card>

        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-4">
            <BarChart3 className="w-8 h-8 text-[#ed8936]" />
            <span className="text-xs font-medium text-[#718096] flex items-center">
              — 0%
            </span>
          </div>
          <h3 className="text-sm font-medium text-[#718096] mb-1">Pending Tasks</h3>
          <p className="text-3xl font-bold text-[#1a202c]">{metrics.pending_tasks || 0}</p>
        </Card>

        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-4">
            <Activity className="w-8 h-8 text-[#f56565]" />
            <span className="text-xs font-medium text-[#f56565] flex items-center">
              <TrendingDown className="w-4 h-4 mr-1" />
              -5%
            </span>
          </div>
          <h3 className="text-sm font-medium text-[#718096] mb-1">SLA Breaches</h3>
          <p className="text-3xl font-bold text-[#1a202c]">{analytics?.sla_breaches || 0}</p>
        </Card>
      </div>

      {/* Task Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <h3 className="text-lg font-semibold text-[#1a202c] mb-6">Task Status Distribution</h3>
          <div className="space-y-4">
            {[
              { label: 'Completed', value: metrics.completed_tasks || 0, color: '#48bb78' },
              { label: 'In Progress', value: Math.floor((metrics.pending_tasks || 0) * 0.6), color: '#70bae7' },
              { label: 'New', value: Math.floor((metrics.pending_tasks || 0) * 0.4), color: '#ed8936' },
              { label: 'Overdue', value: metrics.overdue_tasks || 0, color: '#f56565' },
            ].map((item) => {
              const total = metrics.total_tasks || 1;
              const percentage = ((item.value / total) * 100).toFixed(1);
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#1a202c]">{item.label}</span>
                    <span className="text-sm text-[#718096]">
                      {item.value} ({percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-[#eff2f5] rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: item.color,
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-6 bg-white border border-[#e2e8f0]">
          <h3 className="text-lg font-semibold text-[#1a202c] mb-6">Performance Insights</h3>
          <div className="space-y-6">
            <div>
              <p className="text-sm text-[#718096] mb-2">Average Completion Time</p>
              <p className="text-2xl font-bold text-[#1a202c]">
                {metrics.avg_completion_time_hours?.toFixed(1) || 0} hours
              </p>
            </div>
            <div>
              <p className="text-sm text-[#718096] mb-2">Task Velocity</p>
              <div className="flex items-center">
                <div className="flex-1 bg-[#eff2f5] rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: '75%',
                      backgroundColor: '#70bae7',
                    }}
                  ></div>
                </div>
                <p className="ml-4 text-lg font-bold text-[#70bae7]">75%</p>
              </div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm font-medium text-[#22543d] mb-1">✅ Great Progress!</p>
              <p className="text-xs text-[#22543d]">
                Your completion rate has improved by 8% this {period}.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
