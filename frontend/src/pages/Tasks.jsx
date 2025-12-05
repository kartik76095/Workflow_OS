import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Plus, Filter, Search, History, RotateCcw, AlertCircle, 
  Users, User as UserIcon, Hand, PauseCircle, Play, CheckCircle2,
  Calendar, GitBranch, ChevronRight, FileText
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import TaskExecutionModal from '../components/TaskExecutionModal';
import TaskDetailModal from '../components/TaskDetailModal';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

// ==================== COMPONENT: POLISHED TASK CARD ====================
const TaskCard = ({ task, user, claimTask, onExecute, updateTaskStatus, onClick }) => {
  const hasWorkflow = task.workflow_id;
  const workflowState = task.workflow_state;
  const currentStep = workflowState?.current_step;
  const history = workflowState?.step_history || [];
  
  const currentStepName = currentStep 
    ? (history.find(s => s.step_id === currentStep)?.step_name || 'Unknown Step')
    : (task.status === 'completed' ? 'Completed' : 'Not Started');

  const isGroupTask = !task.assignee_id && task.assignee_group;
  const isMyTask = task.assignee_id === user.id;
  
  const getPriorityColor = (p) => {
    switch(p) {
        case 'critical': return 'bg-red-100 text-red-700 border-red-200';
        case 'high': return 'bg-orange-100 text-orange-700 border-orange-200';
        case 'medium': return 'bg-blue-100 text-blue-700 border-blue-200';
        default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // ✅ NEW: Smart Time Calculation for Card
  const getTimeRemaining = (dateString) => {
    if (!dateString || task.status === 'completed') return null;
    const due = new Date(dateString);
    const now = new Date();
    const diffMs = due - now;

    if (diffMs < 0) return { text: 'Overdue', style: 'text-red-600 font-bold' };

    const diffHrs = diffMs / (1000 * 60 * 60);
    const diffDays = diffHrs / 24;
    const diffMins = diffMs / (1000 * 60);

    if (diffDays >= 1) {
        return { text: `${Math.floor(diffDays)}d left`, style: 'text-blue-600' };
    } else if (diffHrs >= 1) {
        return { text: `${Math.floor(diffHrs)}h left`, style: 'text-orange-600 font-medium' };
    } else {
        return { text: `${Math.floor(diffMins)}m left`, style: 'text-red-500 font-bold' };
    }
  };

  const timeLeft = getTimeRemaining(task.due_date);

  return (
    <div
      onClick={onClick}
      className={`
        group relative flex flex-col bg-white rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden
        ${isMyTask ? 'border-l-4 border-l-[#0a69a7] border-y-[#e2e8f0] border-r-[#e2e8f0] shadow-md hover:shadow-lg' : 'border-[#e2e8f0] shadow-sm hover:shadow-md'}
        ${isGroupTask ? 'bg-gray-50/80 border-dashed' : ''}
      `}
    >
      <div className="p-4 pb-3 space-y-3">
        {/* HEADER */}
        <div>
            <div className="flex justify-between items-start gap-2 mb-1">
                <h4 className="font-semibold text-[#1a202c] text-sm leading-tight line-clamp-2">{task.title}</h4>
                <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${getPriorityColor(task.priority)}`}>{task.priority}</span>
            </div>
            {hasWorkflow && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium mt-1">
                    <GitBranch className="w-3.5 h-3.5 text-[#0a69a7]" />
                    <span className="text-[#0a69a7]">{currentStepName}</span>
                </div>
            )}
        </div>

        {/* METADATA ROW */}
        <div className="flex items-center gap-3 text-xs text-gray-500 pt-1 border-t border-dashed border-gray-100">
            <div className="flex items-center gap-1" title="Due Date">
                <Calendar className="w-3.5 h-3.5" />
                <span className={timeLeft ? 'text-gray-900' : ''}>
                    {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No Date'}
                </span>
                {/* ✅ SHOW TIME LEFT BADGE */}
                {timeLeft && (
                    <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded border bg-gray-50 ${timeLeft.style}`}>
                        {timeLeft.text}
                    </span>
                )}
            </div>
            <div className="w-px h-3 bg-gray-300" />
            <div className="flex items-center gap-1">
                {isGroupTask ? <Users className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
                <span className="truncate max-w-[80px]">{isGroupTask ? task.assignee_group : (task.assignee?.full_name || 'Unassigned')}</span>
            </div>
        </div>

        {/* GLOBAL DATA */}
        {task.metadata && Object.keys(task.metadata).length > 0 && (
            <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100 space-y-1.5">
                {Object.entries(task.metadata).slice(0, 3).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-baseline text-xs">
                        <span className="text-gray-500 font-medium truncate mr-2">{k}:</span>
                        <span className="text-gray-900 font-semibold truncate max-w-[120px]" title={String(v)}>{String(v)}</span>
                    </div>
                ))}
            </div>
        )}
      </div>

      {/* ACTIONS FOOTER */}
      <div className="px-4 py-2 bg-gray-50/50 border-t border-gray-100 flex justify-between items-center group-hover:bg-gray-50 transition-colors">
         <div className="text-[10px] text-gray-400 font-mono">#{task.id.slice(0,6)}</div>
         
         <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {isGroupTask && (
                <Button size="sm" onClick={() => claimTask(task.id)} className="h-7 px-3 text-xs bg-gray-800 hover:bg-black text-white"><Hand className="w-3 h-3 mr-1" /> Claim</Button>
            )}
            
            {isMyTask && (
                <>
                    {/* START */}
                    {task.status === 'new' && (
                        <Button size="sm" onClick={() => updateTaskStatus(task.id, 'in_progress')} className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white"><Play className="w-3 h-3 mr-1" /> Start</Button>
                    )}
                    
                    {/* IN PROGRESS ACTIONS */}
                    {task.status === 'in_progress' && (
                        <>
                            {hasWorkflow && (
                                <Button size="sm" onClick={() => onExecute(task)} className="h-7 px-3 text-xs bg-[#0a69a7] hover:bg-[#085d96] text-white shadow-sm shadow-blue-200">Execute <ChevronRight className="w-3 h-3 ml-1 opacity-70" /></Button>
                            )}
                            
                            {!hasWorkflow && (
                                <Button size="sm" onClick={() => updateTaskStatus(task.id, 'completed')} className="h-7 px-3 text-xs bg-green-600 text-white">Complete</Button>
                            )}

                            {/* PAUSE */}
                            <Button size="sm" variant="ghost" onClick={() => updateTaskStatus(task.id, 'on_hold')} className="h-7 w-7 p-0 text-orange-500 hover:text-orange-700 hover:bg-orange-50" title="Put on Hold">
                                <PauseCircle className="w-4 h-4" />
                            </Button>
                        </>
                    )}

                    {/* RESUME */}
                    {task.status === 'on_hold' && (
                        <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task.id, 'in_progress')} className="h-7 px-3 text-xs border-green-500 text-green-600 hover:bg-green-50">
                            <Play className="w-3 h-3 mr-1" /> Resume
                        </Button>
                    )}
                </>
            )}
         </div>
      </div>
    </div>
  );
};

// ==================== MAIN PAGE COMPONENT ====================
export default function Tasks({ user }) {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]); 
  const [userGroups, setUserGroups] = useState([]); 
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Dialogs & Modals
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [executionTask, setExecutionTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New Task Form State
  const [newTask, setNewTask] = useState({
    title: '', description: '', priority: 'medium', due_date: '', workflow_id: '', metadata: {},
    assign_type: 'user', assignee_id: '', assignee_group: ''
  });
  const [selectedWorkflowSchema, setSelectedWorkflowSchema] = useState([]);

  useEffect(() => {
    fetchTasks();
    fetchWorkflows();
    fetchUsers();
    fetchGroups(); 
  }, [filterStatus]);

  // --- API CALLS ---
  const fetchTasks = async () => {
    const token = localStorage.getItem('token');
    try {
      const params = {};
      if (filterStatus && filterStatus !== 'all') params.status = filterStatus;
      const res = await axios.get(`${API}/tasks`, { headers: { Authorization: `Bearer ${token}` }, params });
      setTasks(res.data.tasks || []);
    } catch (error) { toast.error('Failed to fetch tasks'); } finally { setLoading(false); }
  };

  const fetchWorkflows = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/workflows`, { headers: { Authorization: `Bearer ${token}` } });
      setWorkflows(res.data.workflows || []);
    } catch (error) {}
  };

  const fetchUsers = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/users`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(res.data.users || []);
    } catch (error) {}
  };

  const fetchGroups = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/organization/groups`, { headers: { Authorization: `Bearer ${token}` } });
      setUserGroups(res.data.groups || []);
    } catch (error) { console.error('Failed to fetch groups'); }
  };

  // --- ACTIONS ---
  const handleWorkflowChange = async (workflowId) => {
    setNewTask(prev => ({ ...prev, workflow_id: workflowId, metadata: {} }));
    if (workflowId && workflowId !== 'none') {
        const token = localStorage.getItem('token');
        try {
            const res = await axios.get(`${API}/workflows/${workflowId}`, { headers: { Authorization: `Bearer ${token}` } });
            setSelectedWorkflowSchema(res.data.global_schema || []);
        } catch (error) { setSelectedWorkflowSchema([]); }
    } else { setSelectedWorkflowSchema([]); }
  };

  const claimTask = async (taskId) => {
    const token = localStorage.getItem('token');
    try {
        await axios.put(`${API}/tasks/${taskId}`, { assignee_id: user.id }, { headers: { Authorization: `Bearer ${token}` } });
        toast.success("Task claimed successfully!");
        fetchTasks();
    } catch (error) {
        toast.error("Failed to claim task");
    }
  };

  const createTask = async () => {
    if (!newTask.title) return toast.error('Title is required');
    for (const field of selectedWorkflowSchema) {
        if (field.required && !newTask.metadata[field.label]) {
            return toast.error(`${field.label} is required`);
        }
    }
    const payload = { ...newTask };
    if (payload.assign_type === 'group') {
        payload.assignee_id = null;
        if (!payload.assignee_group) return toast.error("Please select a group");
    } else {
        payload.assignee_group = null;
        if (!payload.assignee_id) return toast.error("Please select a user");
    }
    delete payload.assign_type; 

    const token = localStorage.getItem('token');
    try {
      await axios.post(`${API}/tasks`, payload, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Task created successfully!');
      setCreateDialogOpen(false);
      setNewTask({ title: '', description: '', priority: 'medium', due_date: '', workflow_id: '', metadata: {}, assign_type: 'user', assignee_id: '', assignee_group: '' });
      setSelectedWorkflowSchema([]);
      fetchTasks();
    } catch (error) { toast.error('Failed to create task'); }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    const token = localStorage.getItem('token');
    try { await axios.put(`${API}/tasks/${taskId}`, { status: newStatus }, { headers: { Authorization: `Bearer ${token}` } }); toast.success(`Task status updated`); fetchTasks(); } catch (error) { toast.error('Failed to update task'); }
  };

  // Helper: Render Dynamic Fields
  const renderDynamicField = (field) => {
    const val = newTask.metadata[field.label] || '';
    const handleChange = (value) => setNewTask(prev => ({ ...prev, metadata: { ...prev.metadata, [field.label]: value } }));
    if (field.type === 'select') return <Select value={val} onValueChange={handleChange}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{field.options?.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select>;
    if (field.type === 'checkbox') return <div className="flex items-center space-x-2"><Checkbox checked={!!val} onCheckedChange={handleChange} /><span className="text-sm">{field.label}</span></div>;
    if (field.type === 'date') return <Input type="date" value={val} onChange={(e) => handleChange(e.target.value)} />;
    return <Input value={val} onChange={(e) => handleChange(e.target.value)} placeholder={`Enter ${field.label}`} />;
  };

  const filteredTasks = tasks.filter((task) => task.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const groupedTasks = {
    new: filteredTasks.filter((t) => t.status === 'new'),
    in_progress: filteredTasks.filter((t) => t.status === 'in_progress'),
    on_hold: filteredTasks.filter((t) => t.status === 'on_hold'),
    completed: filteredTasks.filter((t) => t.status === 'completed'),
  };

  return (
    <div data-testid="tasks-page" className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div><h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Tasks</h1><p className="text-[#718096] mt-2">Manage and organize your workflow tasks</p></div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild><Button style={{ backgroundColor: '#0a69a7' }}><Plus className="w-4 h-4 mr-2" /> New Task</Button></DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create New Task</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div><label className="block text-sm font-medium mb-2">Title *</label><Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="Task title" /></div>
              <div className="p-3 bg-gray-50 rounded border border-gray-200 space-y-3">
                <label className="block text-xs font-bold uppercase text-gray-500">Assignment</label>
                <div className="flex gap-2">
                    <Button variant={newTask.assign_type === 'user' ? 'default' : 'outline'} size="sm" onClick={() => setNewTask({...newTask, assign_type: 'user'})} className={newTask.assign_type === 'user' ? 'bg-[#0a69a7]' : ''}>User</Button>
                    <Button variant={newTask.assign_type === 'group' ? 'default' : 'outline'} size="sm" onClick={() => setNewTask({...newTask, assign_type: 'group'})} className={newTask.assign_type === 'group' ? 'bg-[#0a69a7]' : ''}>Group Queue</Button>
                </div>
                {newTask.assign_type === 'user' ? (
                    <Select value={newTask.assignee_id} onValueChange={(val) => setNewTask({ ...newTask, assignee_id: val })}>
                        <SelectTrigger><SelectValue placeholder="Select User" /></SelectTrigger>
                        <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}</SelectContent>
                    </Select>
                ) : (
                    <Select value={newTask.assignee_group} onValueChange={(val) => setNewTask({ ...newTask, assignee_group: val })}>
                        <SelectTrigger><SelectValue placeholder="Select Group" /></SelectTrigger>
                        <SelectContent>{userGroups.length === 0 ? <SelectItem value="General" disabled>No groups found</SelectItem> : userGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                    </Select>
                )}
              </div>
              <div><label className="block text-sm font-medium mb-2">Workflow</label><Select value={newTask.workflow_id || 'none'} onValueChange={handleWorkflowChange}><SelectTrigger><SelectValue placeholder="Select a workflow" /></SelectTrigger><SelectContent><SelectItem value="none">No Workflow</SelectItem>{workflows.map((wf) => (<SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>))}</SelectContent></Select></div>
              {selectedWorkflowSchema.length > 0 && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 space-y-3">
                    <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wide">Global Data</h4>
                    {selectedWorkflowSchema.map(field => <div key={field.id}><label className="block text-xs font-medium text-blue-700 mb-1">{field.label} {field.required && '*'}</label>{renderDynamicField(field)}</div>)}
                </div>
              )}
              <div><label className="block text-sm font-medium mb-2">Description</label><textarea className="w-full px-3 py-2 border border-[#e2e8f0] rounded-md" rows={3} value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} /></div>
               <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-2">Priority</label><Select value={newTask.priority} onValueChange={(val) => setNewTask({ ...newTask, priority: val })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
                  <div><label className="block text-sm font-medium mb-2">Due Date</label><Input type="date" value={newTask.due_date} onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })} /></div>
              </div>
              <Button onClick={createTask} className="w-full" style={{ backgroundColor: '#0a69a7' }}>Create Task</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-6 min-w-max h-full">
            {Object.entries(groupedTasks).map(([status, taskList]) => (
            <div key={status} className="w-80 bg-[#eff2f5] p-4 rounded-lg flex flex-col h-full max-h-full">
                <h3 className="text-sm font-bold text-gray-500 uppercase mb-4 flex justify-between shrink-0">
                    <span>{status.replace('_', ' ')}</span>
                    <span className="bg-white px-2 py-0.5 rounded-full text-xs border shadow-sm">{taskList.length}</span>
                </h3>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-gray-300">
                {taskList.map((task) => (
                    <TaskCard 
                    key={task.id} task={task} user={user}
                    claimTask={claimTask} updateTaskStatus={updateTaskStatus} onExecute={setExecutionTask}
                    onClick={() => setSelectedTask(task)} // ✅ Click opens details
                    />
                ))}
                </div>
            </div>
            ))}
        </div>
      </div>

      {/* Modals */}
      <TaskExecutionModal task={executionTask} isOpen={!!executionTask} onClose={() => setExecutionTask(null)} onUpdate={fetchTasks} />
      
      <TaskDetailModal 
        task={selectedTask} 
        isOpen={!!selectedTask} 
        onClose={() => setSelectedTask(null)} 
      />

    </div>
  );
}