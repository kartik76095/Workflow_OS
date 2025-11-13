import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Filter, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Tasks({ user }) {
  const [tasks, setTasks] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
    workflow_id: '',
  });

  useEffect(() => {
    fetchTasks();
    fetchWorkflows();
    fetchPendingApprovals();
  }, [filterStatus]);

  const fetchTasks = async () => {
    const token = localStorage.getItem('token');
    try {
      const params = {};
      if (filterStatus && filterStatus !== 'all') {
        params.status = filterStatus;
      }
      const res = await axios.get(`${API}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setTasks(res.data.tasks || []);
    } catch (error) {
      toast.error('Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflows = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/workflows`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setWorkflows(res.data.workflows || []);
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    }
  };

  const fetchPendingApprovals = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/workflows/pending-approvals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPendingApprovals(res.data.pending_approvals || []);
    } catch (error) {
      console.error('Failed to fetch pending approvals:', error);
    }
  };

  const createTask = async () => {
    if (!newTask.title) {
      toast.error('Title is required');
      return;
    }

    const token = localStorage.getItem('token');
    try {
      await axios.post(`${API}/tasks`, newTask, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success('Task created successfully!');
      setCreateDialogOpen(false);
      setNewTask({ title: '', description: '', priority: 'medium', due_date: '', workflow_id: '' });
      fetchTasks();
      fetchPendingApprovals();
    } catch (error) {
      toast.error('Failed to create task');
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    const token = localStorage.getItem('token');
    try {
      await axios.patch(
        `${API}/tasks/${taskId}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Task updated');
      fetchTasks();
    } catch (error) {
      toast.error('Failed to update task');
    }
  };

  const progressWorkflow = async (taskId) => {
    const token = localStorage.getItem('token');
    try {
      await axios.post(
        `${API}/tasks/${taskId}/workflow/progress`,
        { action: 'progress', comment: 'Progressed via UI' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Workflow progressed');
      fetchTasks();
      fetchPendingApprovals();
    } catch (error) {
      toast.error('Failed to progress workflow');
    }
  };

  const approveWorkflowStep = async (taskId, stepId, action, comment = '') => {
    const token = localStorage.getItem('token');
    try {
      await axios.post(
        `${API}/tasks/${taskId}/workflow/approve`,
        { task_id: taskId, step_id: stepId, action, comment },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(`Step ${action}d`);
      fetchTasks();
      fetchPendingApprovals();
    } catch (error) {
      toast.error(`Failed to ${action} step`);
    }
  };

  const filteredTasks = tasks.filter((task) =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedTasks = {
    new: filteredTasks.filter((t) => t.status === 'new'),
    in_progress: filteredTasks.filter((t) => t.status === 'in_progress'),
    on_hold: filteredTasks.filter((t) => t.status === 'on_hold'),
    completed: filteredTasks.filter((t) => t.status === 'completed'),
  };

  const TaskCard = ({ task }) => (
    <div
      data-testid={`task-${task.id}`}
      className="bg-white p-4 rounded-lg border border-[#e2e8f0] shadow-sm hover:shadow-md transition-all cursor-pointer"
    >
      <h4 className="font-medium text-[#1a202c] mb-2">{task.title}</h4>
      <p className="text-sm text-[#718096] mb-3">{task.description || 'No description'}</p>
      <div className="flex items-center justify-between">
        <span
          className="px-2 py-1 text-xs font-medium rounded capitalize"
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
        {task.status !== 'completed' && (
          <Button
            size="sm"
            onClick={() => updateTaskStatus(task.id, 'completed')}
            style={{ backgroundColor: '#48bb78' }}
          >
            Complete
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div data-testid="tasks-page" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Tasks
          </h1>
          <p className="text-[#718096] mt-2">Manage and organize your workflow tasks</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="create-task-button" style={{ backgroundColor: '#0a69a7' }}>
              <Plus className="w-4 h-4 mr-2" />
              New Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-2">Title</label>
                <Input
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder="Task title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#e2e8f0] rounded-md"
                  rows={3}
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  placeholder="Task description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Priority</label>
                <Select value={newTask.priority} onValueChange={(val) => setNewTask({ ...newTask, priority: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Due Date</label>
                <Input
                  type="date"
                  value={newTask.due_date}
                  onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
                />
              </div>
              <Button onClick={createTask} className="w-full" style={{ backgroundColor: '#0a69a7' }}>
                Create Task
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#718096]" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Object.entries(groupedTasks).map(([status, taskList]) => (
          <div key={status} className="bg-[#eff2f5] p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-[#1a202c] uppercase mb-4 flex items-center justify-between">
              <span>{status.replace('_', ' ')}</span>
              <span className="bg-white px-2 py-1 rounded text-xs">{taskList.length}</span>
            </h3>
            <div className="space-y-3">
              {taskList.length === 0 ? (
                <p className="text-sm text-[#718096] text-center py-4">No tasks</p>
              ) : (
                taskList.map((task) => <TaskCard key={task.id} task={task} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
