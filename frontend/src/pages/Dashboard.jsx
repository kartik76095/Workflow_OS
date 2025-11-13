import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart3, CheckCircle2, Clock, AlertCircle, TrendingUp } from 'lucide-react';
import { Card } from '../components/ui/card';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    const token = localStorage.getItem('token');
    try {
      const [analyticsRes, tasksRes] = await Promise.all([
        axios.get(`${API}/analytics/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/tasks?limit=5`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      setAnalytics(analyticsRes.data);
      setRecentTasks(tasksRes.data.tasks);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
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

  const statCards = [
    {
      title: 'Total Tasks',
      value: metrics.total_tasks || 0,
      icon: BarChart3,
      color: '#0a69a7',
      bgColor: '#70bae7',
    },
    {
      title: 'Completed',
      value: metrics.completed_tasks || 0,
      icon: CheckCircle2,
      color: '#48bb78',
      bgColor: '#9ae6b4',
    },
    {
      title: 'Pending',
      value: metrics.pending_tasks || 0,
      icon: Clock,
      color: '#ed8936',
      bgColor: '#fbd38d',
    },
    {
      title: 'Overdue',
      value: metrics.overdue_tasks || 0,
      icon: AlertCircle,
      color: '#f56565',
      bgColor: '#fc8181',
    },
  ];

  return (
    <div data-testid="dashboard" className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Dashboard
        </h1>
        <p className="text-[#718096] mt-2">Overview of your workflow tasks</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="p-6 bg-white border border-[#e2e8f0] shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#718096]">{stat.title}</p>
                  <p className="text-3xl font-bold mt-2" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                </div>
                <div
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `${stat.bgColor}20` }}
                >
                  <Icon style={{ color: stat.color }} className="w-6 h-6" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Completion Rate */}
      <Card className="p-6 bg-white border border-[#e2e8f0]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1a202c]">Completion Rate</h3>
          <TrendingUp className="w-5 h-5 text-[#48bb78]" />
        </div>
        <div className="flex items-center">
          <div className="flex-1 bg-[#eff2f5] rounded-full h-4 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${metrics.completion_rate || 0}%`,
                backgroundColor: '#48bb78',
              }}
            ></div>
          </div>
          <p className="ml-4 text-2xl font-bold text-[#48bb78]">
            {metrics.completion_rate?.toFixed(1) || 0}%
          </p>
        </div>
      </Card>

      {/* Recent Tasks */}
      <Card className="p-6 bg-white border border-[#e2e8f0]">
        <h3 className="text-lg font-semibold text-[#1a202c] mb-4">Recent Tasks</h3>
        {recentTasks.length === 0 ? (
          <p className="text-[#718096] text-center py-8">No tasks yet. Create your first task!</p>
        ) : (
          <div className="space-y-3">
            {recentTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-4 bg-[#eff2f5] rounded-lg hover:bg-[#e2e8f0] transition-colors"
              >
                <div className="flex-1">
                  <p className="font-medium text-[#1a202c]">{task.title}</p>
                  <p className="text-sm text-[#718096] mt-1">
                    {task.description || 'No description'}
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <span
                    className="px-3 py-1 text-xs font-medium rounded-full capitalize"
                    style={{
                      backgroundColor:
                        task.priority === 'critical'
                          ? '#fed7d7'
                          : task.priority === 'high'
                          ? '#feebc8'
                          : task.priority === 'medium'
                          ? '#bee3f8'
                          : '#c6f6d5',
                      color:
                        task.priority === 'critical'
                          ? '#c53030'
                          : task.priority === 'high'
                          ? '#c05621'
                          : task.priority === 'medium'
                          ? '#2c5282'
                          : '#22543d',
                    }}
                  >
                    {task.priority}
                  </span>
                  <span
                    className="px-3 py-1 text-xs font-medium rounded-full capitalize"
                    style={{
                      backgroundColor:
                        task.status === 'completed'
                          ? '#c6f6d5'
                          : task.status === 'in_progress'
                          ? '#bee3f8'
                          : '#feebc8',
                      color:
                        task.status === 'completed'
                          ? '#22543d'
                          : task.status === 'in_progress'
                          ? '#2c5282'
                          : '#c05621',
                    }}
                  >
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
