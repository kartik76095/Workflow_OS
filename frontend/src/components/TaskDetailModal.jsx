import React from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription 
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { 
  Calendar, User, Tag, GitBranch, Clock, 
  CheckCircle2, AlertCircle, FileText, Layout 
} from 'lucide-react';

export default function TaskDetailModal({ task, isOpen, onClose }) {
  if (!task) return null;

  const workflowState = task.workflow_state || {};
  const history = workflowState.step_history || [];
  
  // Format Date Helper
  const formatDate = (dateString) => {
    if (!dateString) return 'No date set';
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  // ✅ NEW: Smart Time Calculation
  const getTimeRemaining = (dateString) => {
    if (!dateString) return null;
    const due = new Date(dateString);
    const now = new Date();
    const diffMs = due - now;

    if (diffMs < 0) return { text: 'Overdue', style: 'bg-red-100 text-red-700 border-red-200 font-bold' };

    const diffHrs = diffMs / (1000 * 60 * 60);
    const diffDays = diffHrs / 24;
    const diffMins = diffMs / (1000 * 60);

    if (diffDays >= 1) {
        return { text: `${Math.floor(diffDays)} days left`, style: 'bg-blue-50 text-blue-700 border-blue-200' };
    } else if (diffHrs >= 1) {
        return { text: `${Math.floor(diffHrs)}h left`, style: 'bg-orange-50 text-orange-700 border-orange-200 font-medium' };
    } else {
        return { text: `${Math.floor(diffMins)}m left`, style: 'bg-red-50 text-red-600 border-red-200 font-bold animate-pulse' };
    }
  };

  const timeLeft = getTimeRemaining(task.due_date);

  // Get Step Status Color
  const getStepColor = (status) => {
    switch(status) {
      case 'completed': return 'text-green-600 bg-green-50 border-green-200';
      case 'in_progress': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'rejected': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        
        {/* Header Section */}
        <div className="p-6 border-b bg-muted/30">
            <div className="flex justify-between items-start mb-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="uppercase text-[10px] tracking-wider">
                            {task.status.replace('_', ' ')}
                        </Badge>
                        {task.priority === 'critical' && <Badge variant="destructive">CRITICAL</Badge>}
                    </div>
                    <DialogTitle className="text-2xl font-bold text-[#1a202c]">
                        {task.title}
                    </DialogTitle>
                </div>
                {task.workflow_id && (
                     <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100">
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>{workflowState.current_step ? `Step: ${history.find(s => s.step_id === workflowState.current_step)?.step_name || 'Processing'}` : 'Workflow Completed'}</span>
                     </div>
                )}
            </div>
            
            <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span>Assignee: <b className="text-foreground">{task.assignee?.full_name || task.assignee_group || 'Unassigned'}</b></span>
                </div>
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>Due: <b className="text-foreground">{formatDate(task.due_date)}</b></span>
                    {/* ✅ NEW: Time Left Badge */}
                    {timeLeft && task.status !== 'completed' && (
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${timeLeft.style}`}>
                            {timeLeft.text}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Layout className="w-4 h-4 text-gray-400" />
                    <span>ID: <span className="font-mono text-xs">{task.id.slice(0, 8)}</span></span>
                </div>
            </div>
        </div>

        <ScrollArea className="flex-1 p-6">
            <div className="grid grid-cols-3 gap-8">
                
                {/* LEFT COL: Details & Data */}
                <div className="col-span-2 space-y-8">
                    {/* Description */}
                    <section>
                        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-2 flex items-center gap-2">
                            <FileText className="w-4 h-4" /> Description
                        </h3>
                        <div className="bg-muted/30 p-4 rounded-lg text-sm text-gray-700 leading-relaxed border border-border/50">
                            {task.description || "No description provided."}
                        </div>
                    </section>

                    {/* Global Data Fields (The "Required Fields") */}
                    {task.metadata && Object.keys(task.metadata).length > 0 && (
                        <section>
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-2 flex items-center gap-2">
                                <Layout className="w-4 h-4" /> Global Data
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.entries(task.metadata).map(([key, value]) => (
                                    <div key={key} className="p-3 bg-white border rounded-lg shadow-sm">
                                        <div className="text-xs text-muted-foreground font-medium uppercase mb-1">{key}</div>
                                        <div className="text-sm font-semibold text-gray-900 break-words">{String(value)}</div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                {/* RIGHT COL: Timeline / History */}
                <div className="col-span-1 border-l pl-8 relative">
                    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Activity
                    </h3>
                    
                    <div className="space-y-6 relative">
                        {/* Timeline Line */}
                        <div className="absolute left-[7px] top-2 bottom-2 w-[2px] bg-gray-100" />

                        {history.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No activity recorded.</p>
                        ) : (
                            history.map((step, idx) => (
                                <div key={idx} className="relative pl-6 group">
                                    {/* Dot */}
                                    <div className={`absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white shadow-sm z-10 ${
                                        step.status === 'completed' || step.status === 'approve' ? 'bg-green-500' : 
                                        step.status === 'started' ? 'bg-blue-500' : 'bg-gray-300'
                                    }`} />
                                    
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-gray-900">{step.step_name}</span>
                                        <span className="text-xs text-muted-foreground">{new Date(step.started_at).toLocaleDateString()}</span>
                                        
                                        <div className={`mt-1.5 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium w-fit border ${getStepColor(step.status)}`}>
                                            {step.status}
                                        </div>

                                        {/* Step Data/Form Inputs */}
                                        {step.data && Object.keys(step.data).length > 0 && (
                                            <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-100 text-xs">
                                                {Object.entries(step.data).map(([k, v]) => (
                                                    <div key={k} className="flex justify-between border-b border-gray-100 last:border-0 py-1">
                                                        <span className="text-gray-500">{k}:</span>
                                                        <span className="font-medium">{String(v)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </ScrollArea>
        
        <div className="p-4 border-t bg-gray-50 flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}