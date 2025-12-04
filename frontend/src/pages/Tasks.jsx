import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Plus, Filter, Search, History, RotateCcw, AlertCircle, 
  Users, User as UserIcon, Hand, PauseCircle, Play, CheckCircle2 
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { toast } from 'sonner';
import TaskExecutionModal from '../components/TaskExecutionModal';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

// ==================== COMPONENT: TASK CARD ====================
const TaskCard = ({ task, user, openHistoryDialog, approveWorkflowStep, claimTask, onExecute, updateTaskStatus }) => {
  const hasWorkflow = task.workflow_id;
  const workflowState = task.workflow_state;
  const currentStep = workflowState?.current_step;
  const pendingApproval = workflowState?.pending_approvals?.find(p => p.assigned_to === user.id);
  
  const isGroupTask = !task.assignee_id && task.assignee_group;
  const isMyTask = task.assignee_id === user.id;

  return (
    <div
      data-testid={`task-${task.id}`}
      className={`p-4 rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer relative group 
        ${isGroupTask ? 'bg-gray-50 border-dashed border-gray-300' : 'bg-white border-solid border-[#e2e8f0]'}
        ${isMyTask ? 'ring-1 ring-[#0a69a7] border-[#0a69a7]' : ''}
      `}
    >
      <div className="flex justify-between items-start mb-2">
        <h4 className="font-medium text-[#1a202c] flex-1 mr-2">{task.title}</h4>
        {isGroupTask && (
            <span className="flex items-center text-[10px] font-bold uppercase bg-gray-200 text-gray-600 px-2 py-1 rounded-full">
                <Users className="w-3 h-3 mr-1" /> {task.assignee_group}
            </span>
        )}
        {isMyTask && (
            <span className="flex items-center text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                <UserIcon className="w-3 h-3 mr-1" /> You
            </span>
        )}
      </div>

      <p className="text-sm text-[#718096] mb-3">{task.description || 'No description'}</p>
      
      {/* Global Data Preview */}
      {task.metadata && Object.keys(task.metadata).length > 0 && (
        <div className="mb-3 p-2 bg-gray-50 border border-gray-100 rounded text-xs space-y-1">
            {Object.entries(task.metadata).slice(0, 2).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                    <span className="text-gray-500">{k}:</span>
                    <span className="font-medium truncate ml-2">{String(v)}</span>
                </div>
            ))}
        </div>
      )}

      {/* Workflow Status */}
      {hasWorkflow && (
        <div className="mb-3 p-2 bg-[#eff2f5] rounded text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#0a69a7]">
                🔄 {workflowState.step_history?.find(s => s.step_id === currentStep)?.step_name || 'Processing'}
            </span>
            {(user.role === 'super_admin' || user.role === 'admin') && (
              <button onClick={(e) => { e.stopPropagation(); openHistoryDialog(task); }} className="text-[#0a69a7] hover:text-[#084d7a]">
                <History className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Approvals */}
      {pendingApproval && (
        <div className="mb-3 p-2 bg-[#feebc8] rounded text-xs">
          <p className="font-medium text-[#c05621] mb-2">⏳ Approval Required</p>
          <div className="flex space-x-2">
            <button onClick={(e) => { e.stopPropagation(); approveWorkflowStep(task.id, pendingApproval.step_id, 'approve'); }} className="px-2 py-1 bg-[#48bb78] text-white rounded hover:bg-[#38a169]">✓</button>
            <button onClick={(e) => { e.stopPropagation(); approveWorkflowStep(task.id, pendingApproval.step_id, 'reject'); }} className="px-2 py-1 bg-[#f56565] text-white rounded hover:bg-[#e53e3e]">✗</button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between mt-4">
        <span className={`px-2 py-1 text-xs font-medium rounded capitalize bg-gray-100 text-gray-600`}>
          {task.priority}
        </span>
        
        <div className="flex space-x-2">
          {/* 1. CLAIM (Group Task) */}
          {isGroupTask && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); claimTask(task.id); }} className="bg-gray-800 hover:bg-black text-white h-7 text-xs">
                <Hand className="w-3 h-3 mr-1" /> Claim
            </Button>
          )}

          {/* 2. START (My Task, Status: New) */}
          {isMyTask && task.status === 'new' && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, 'in_progress'); }} className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs">
                <Play className="w-3 h-3 mr-1" /> Start
            </Button>
          )}

          {/* 3. EXECUTE / PAUSE / COMPLETE (My Task, Status: In Progress) */}
          {isMyTask && task.status === 'in_progress' && (
            <>
                {hasWorkflow && currentStep && !pendingApproval && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); onExecute(task); }} style={{ backgroundColor: '#0a69a7' }} className="h-7 text-xs">
                    Execute
                    </Button>
                )}
                
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, 'on_hold'); }} className="h-7 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50" title="Put on Hold">
                    <PauseCircle className="w-4 h-4" />
                </Button>

                {!hasWorkflow && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, 'completed'); }} style={{ backgroundColor: '#48bb78' }} className="h-7 text-xs">
                    Complete
                    </Button>
                )}
            </>
          )}

          {/* 4. RESUME (My Task, Status: On Hold) */}
          {isMyTask && task.status === 'on_hold' && (
             <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updateTaskStatus(task.id, 'in_progress'); }} className="h-7 text-xs border-green-500 text-green-600 hover:bg-green-50">
                <Play className="w-3 h-3 mr-1" /> Resume
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== COMPONENT: MAIN PAGE ====================
export default function Tasks({ user }) {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]); 
  const [userGroups, setUserGroups] = useState([]); // ✅ Dynamic Groups State
  const [workflows, setWorkflows] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Dialogs & Modals
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [executionTask, setExecutionTask] = useState(null);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [selectedTaskForHistory, setSelectedTaskForHistory] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New Task Form State
  const [newTask, setNewTask] = useState({
    title: '', description: '', priority: 'medium', due_date: '', workflow_id: '', metadata: {},
    assign_type: 'user', // 'user' or 'group'
    assignee_id: '', 
    assignee_group: ''
  });
  const [selectedWorkflowSchema, setSelectedWorkflowSchema] = useState([]);

  useEffect(() => {
    fetchTasks();
    fetchWorkflows();
    fetchUsers();
    fetchGroups(); // ✅ Fetch Groups on load
    fetchPendingApprovals();
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

  // ✅ New Group Fetcher
  const fetchGroups = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/organization/groups`, { headers: { Authorization: `Bearer ${token}` } });
      setUserGroups(res.data.groups || []);
    } catch (error) { console.error('Failed to fetch groups'); }
  };

  const fetchPendingApprovals = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/workflows/pending-approvals`, { headers: { Authorization: `Bearer ${token}` } });
      setPendingApprovals(res.data.pending_approvals || []);
    } catch (error) {}
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

    // Validate Required Global Fields
    for (const field of selectedWorkflowSchema) {
        if (field.required && !newTask.metadata[field.label]) {
            return toast.error(`${field.label} is required`);
        }
    }

    // Prepare Payload
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
      // Reset Form
      setNewTask({ title: '', description: '', priority: 'medium', due_date: '', workflow_id: '', metadata: {}, assign_type: 'user', assignee_id: '', assignee_group: '' });
      setSelectedWorkflowSchema([]);
      fetchTasks();
    } catch (error) { toast.error('Failed to create task'); }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    const token = localStorage.getItem('token');
    try { await axios.put(`${API}/tasks/${taskId}`, { status: newStatus }, { headers: { Authorization: `Bearer ${token}` } }); toast.success(`Task status updated: ${newStatus}`); fetchTasks(); } catch (error) { toast.error('Failed to update task'); }
  };

  const approveWorkflowStep = async (taskId, stepId, action, comment = '') => {
    const token = localStorage.getItem('token');
    try { await axios.post(`${API}/tasks/${taskId}/workflow/approve`, { task_id: taskId, step_id: stepId, action, comment }, { headers: { Authorization: `Bearer ${token}` } }); toast.success(`Step ${action}d`); fetchTasks(); fetchPendingApprovals(); } catch (error) { toast.error(`Failed to ${action} step`); }
  };

  const progressWorkflow = async (taskId) => {
    const token = localStorage.getItem('token');
    try { await axios.post(`${API}/tasks/${taskId}/workflow/progress`, { action: 'progress', comment: 'Progressed via UI' }, { headers: { Authorization: `Bearer ${token}` } }); toast.success('Workflow progressed'); fetchTasks(); } catch (error) { toast.error('Failed to progress workflow'); }
  };

  const rewindWorkflow = async (taskId, targetStepId, reason) => {
    const token = localStorage.getItem('token');
    try { const params = new URLSearchParams({ target_step_id: targetStepId, reason }); await axios.post(`${API}/tasks/${taskId}/workflow/rewind?${params.toString()}`, {}, { headers: { Authorization: `Bearer ${token}` } }); toast.success('Rewound!'); setHistoryDialogOpen(false); fetchTasks(); } catch (error) { toast.error('Failed to rewind'); }
  };

  // Helper: Render Dynamic Fields in Creation Modal
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
    <div data-testid="tasks-page" className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Tasks</h1><p className="text-[#718096] mt-2">Manage and organize your workflow tasks</p></div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild><Button style={{ backgroundColor: '#0a69a7' }}><Plus className="w-4 h-4 mr-2" /> New Task</Button></DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create New Task</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-4">
              <div><label className="block text-sm font-medium mb-2">Title *</label><Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="Task title" /></div>
              
              {/* Assignment Section */}
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
                        {/* ✅ DYNAMIC GROUP DROPDOWN */}
                        <SelectContent>
                            {userGroups.length === 0 ? (
                                <SelectItem value="General" disabled>No groups found</SelectItem>
                            ) : (
                                userGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)
                            )}
                        </SelectContent>
                    </Select>
                )}
              </div>

              <div><label className="block text-sm font-medium mb-2">Workflow</label><Select value={newTask.workflow_id || 'none'} onValueChange={handleWorkflowChange}><SelectTrigger><SelectValue placeholder="Select a workflow" /></SelectTrigger><SelectContent><SelectItem value="none">No Workflow</SelectItem>{workflows.map((wf) => (<SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>))}</SelectContent></Select></div>
              
              {/* Dynamic Global Fields */}
              {selectedWorkflowSchema.length > 0 && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 space-y-3">
                    <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wide">Global Data</h4>
                    {selectedWorkflowSchema.map(field => <div key={field.id}><label className="block text-xs font-medium text-blue-700 mb-1">{field.label} {field.required && '*'}</label>{renderDynamicField(field)}</div>)}
                </div>
              )}

              <div><label className="block text-sm font-medium mb-2">Description</label><textarea className="w-full px-3 py-2 border border-[#e2e8f0] rounded-md" rows={3} value={newTask.description} onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} /></div>
              <Button onClick={createTask} className="w-full" style={{ backgroundColor: '#0a69a7' }}>Create Task</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Object.entries(groupedTasks).map(([status, taskList]) => (
          <div key={status} className="bg-[#eff2f5] p-4 rounded-lg min-h-[500px]">
            <h3 className="text-sm font-semibold text-[#1a202c] uppercase mb-4 flex justify-between"><span>{status.replace('_', ' ')}</span><span className="bg-white px-2 py-1 rounded text-xs">{taskList.length}</span></h3>
            <div className="space-y-3">
              {taskList.map((task) => (
                <TaskCard 
                  key={task.id} task={task} user={user}
                  openHistoryDialog={() => { setSelectedTaskForHistory(task); setHistoryDialogOpen(true); }}
                  approveWorkflowStep={approveWorkflowStep} claimTask={claimTask}
                  updateTaskStatus={updateTaskStatus} onExecute={setExecutionTask}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <TaskExecutionModal task={executionTask} isOpen={!!executionTask} onClose={() => setExecutionTask(null)} onUpdate={fetchTasks} />
      
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
         <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Workflow History</DialogTitle></DialogHeader>
            {selectedTaskForHistory && (
                <div className="space-y-4">
                    {selectedTaskForHistory.workflow_state?.step_history?.map((step, idx) => (
                        <div key={idx} className="p-3 bg-gray-50 border rounded flex justify-between">
                            <span>{step.step_name} ({step.status})</span>
                            {step.status !== 'started' && <Button size="sm" onClick={() => rewindWorkflow(selectedTaskForHistory.id, step.step_id, "Undo")}>Rewind</Button>}
                        </div>
                    ))}
                </div>
            )}
         </DialogContent>
      </Dialog>
    </div>
  );
}