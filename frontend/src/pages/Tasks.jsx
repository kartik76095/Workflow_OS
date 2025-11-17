import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Filter, Search, History, RotateCcw, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
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
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedTaskForHistory, setSelectedTaskForHistory] = useState(null);

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

  const rewindWorkflow = async (taskId, targetStepId, reason) => {
    const token = localStorage.getItem('token');
    try {
      const params = new URLSearchParams({ target_step_id: targetStepId, reason });
      await axios.post(
        `${API}/tasks/${taskId}/workflow/rewind?${params.toString()}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('⏪ Workflow rewound successfully!');
      setHistoryDialogOpen(false);
      fetchTasks();
    } catch (error) {
      toast.error('Failed to rewind workflow: ' + (error.response?.data?.detail || 'Unknown error'));
    }
  };

  const openHistoryDialog = (task) => {
    setSelectedTaskForHistory(task);
    setHistoryDialogOpen(true);
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

  const TaskCard = ({ task }) => {
    const hasWorkflow = task.workflow_id;
    const workflowState = task.workflow_state;
    const currentStep = workflowState?.current_step;
    const pendingApproval = workflowState?.pending_approvals?.find(p => p.assigned_to === user.id);

    return (
      <div
        data-testid={`task-${task.id}`}
        className="bg-white p-4 rounded-lg border border-[#e2e8f0] shadow-sm hover:shadow-md transition-all cursor-pointer"
      >
        <h4 className="font-medium text-[#1a202c] mb-2">{task.title}</h4>
        <p className="text-sm text-[#718096] mb-3">{task.description || 'No description'}</p>
        
        {/* Workflow Status */}
        {hasWorkflow && (
          <div className="mb-3 p-2 bg-[#eff2f5] rounded text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#0a69a7]">🔄 In Workflow</span>
              {currentStep && (
                <span className="text-[#718096]">
                  Step: {workflowState.step_history?.find(s => s.step_id === currentStep)?.step_name || currentStep}
                </span>
              )}
            </div>
            {workflowState?.completed_steps?.length > 0 && (
              <div className="mt-1 text-[#48bb78]">
                ✅ {workflowState.completed_steps.length} steps completed
              </div>
            )}
          </div>
        )}

        {/* Pending Approval */}
        {pendingApproval && (
          <div className="mb-3 p-2 bg-[#feebc8] rounded text-xs">
            <p className="font-medium text-[#c05621] mb-2">⏳ Needs Your Approval</p>
            <div className="flex space-x-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  approveWorkflowStep(task.id, pendingApproval.step_id, 'approve');
                }}
                className="px-2 py-1 bg-[#48bb78] text-white rounded text-xs hover:bg-[#38a169]"
              >
                ✓ Approve
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  approveWorkflowStep(task.id, pendingApproval.step_id, 'reject');
                }}
                className="px-2 py-1 bg-[#f56565] text-white rounded text-xs hover:bg-[#e53e3e]"
              >
                ✗ Reject
              </button>
            </div>
          </div>
        )}

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
          
          <div className="flex space-x-2">
            {hasWorkflow && currentStep && !pendingApproval ? (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  progressWorkflow(task.id);
                }}
                style={{ backgroundColor: '#0a69a7' }}
              >
                Next Step
              </Button>
            ) : !hasWorkflow && task.status !== 'completed' ? (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  updateTaskStatus(task.id, 'completed');
                }}
                style={{ backgroundColor: '#48bb78' }}
              >
                Complete
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

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
              <div>
                <label className="block text-sm font-medium mb-2">Workflow (Optional)</label>
                <Select value={newTask.workflow_id || 'none'} onValueChange={(val) => setNewTask({ ...newTask, workflow_id: val === 'none' ? '' : val })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span>No Workflow</span>
                    </SelectItem>
                    {workflows.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.id}>
                        <span>{workflow.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[#718096] mt-1">
                  {newTask.workflow_id ? '🔄 Task will start in selected workflow' : 'Task will be created without workflow'}
                </p>
              </div>
              <Button onClick={createTask} className="w-full" style={{ backgroundColor: '#0a69a7' }}>
                Create Task
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && (
        <Card className="p-6 bg-gradient-to-r from-[#feebc8] to-[#fed7d7] border-[#ed8936]">
          <h3 className="text-lg font-semibold text-[#c05621] mb-4 flex items-center">
            ⏳ Pending Approvals ({pendingApprovals.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingApprovals.slice(0, 6).map((item, idx) => (
              <div key={idx} className="bg-white p-4 rounded-lg shadow-sm">
                <h4 className="font-medium text-[#1a202c] mb-2">{item.task.title}</h4>
                <p className="text-sm text-[#718096] mb-3">Step: {item.workflow_step}</p>
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    onClick={() => approveWorkflowStep(item.task.id, item.approval.step_id, 'approve')}
                    style={{ backgroundColor: '#48bb78' }}
                  >
                    ✓ Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveWorkflowStep(item.task.id, item.approval.step_id, 'reject')}
                  >
                    ✗ Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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
