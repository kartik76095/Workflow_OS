import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { CheckCircle2 } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function TaskExecutionModal({ task, isOpen, onClose, onUpdate }) {
  const [formData, setFormData] = useState({});
  const [currentSchema, setCurrentSchema] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && task?.workflow_id) {
      fetchWorkflowContext();
    }
  }, [isOpen, task]);

  const fetchWorkflowContext = async () => {
    const token = localStorage.getItem('token');
    try {
        const res = await axios.get(`${API}/workflows/${task.workflow_id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        // 1. Get Global Fields (Defined in Workflow Builder background)
        const globalFields = res.data.global_schema || [];
        
        // 2. Get Step Fields (Defined on the specific Node)
        const currentStepId = task.workflow_state?.current_step;
        const currentNode = res.data.nodes.find(n => n.id === currentStepId);
        const stepFields = currentNode?.data?.formSchema || [];

        // 3. MERGE THEM: Global fields appear first, then Step fields
        const combinedSchema = [...globalFields, ...stepFields];
        setCurrentSchema(combinedSchema);
        
        // 4. Pre-fill form (Cascading Logic)
        // We check if 'task.metadata' already has value for ANY of these fields
        const initialData = {};
        combinedSchema.forEach(field => {
            if (task.metadata && task.metadata[field.label]) {
                initialData[field.label] = task.metadata[field.label];
            }
        });
        setFormData(initialData);

    } catch (error) {
        console.error("Failed to load workflow context", error);
    }
  };

  const handleSubmit = async () => {
    // Validate Required Fields
    for (const field of currentSchema) {
        if (field.required && !formData[field.label]) {
            toast.error(`${field.label} is required`);
            return;
        }
    }

    setLoading(true);
    const token = localStorage.getItem('token');
    try {
        // Submit Data & Progress Workflow
        await axios.post(
            `${API}/tasks/${task.id}/workflow/progress`,
            { 
                action: 'progress', 
                comment: 'Completed via Task Execution Form',
                data: formData 
            },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        toast.success("Step completed successfully!");
        onUpdate(); // Refresh parent list
        onClose();
    } catch (error) {
        toast.error("Failed to complete step");
    } finally {
        setLoading(false);
    }
  };

  const renderField = (field) => {
    const commonProps = {
        disabled: loading,
        value: formData[field.label] || '',
        onChange: (e) => setFormData({ ...formData, [field.label]: e.target.value })
    };

    switch (field.type) {
        case 'select':
            return (
                <Select 
                    value={formData[field.label]} 
                    onValueChange={(val) => setFormData({ ...formData, [field.label]: val })}
                >
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                        {field.options?.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        case 'checkbox':
            return (
                <div className="flex items-center space-x-2">
                    <Checkbox 
                        checked={formData[field.label] || false}
                        onCheckedChange={(checked) => setFormData({ ...formData, [field.label]: checked })}
                    />
                    <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        {field.label}
                    </label>
                </div>
            );
        case 'date':
            return <Input type="date" {...commonProps} />;
        default:
            return <Input type="text" placeholder={field.label} {...commonProps} />;
    }
  };

  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <CheckCircle2 className="w-5 h-5 text-[#0a69a7]" />
             Execute Step: {task.workflow_state?.step_history?.slice(-1)[0]?.step_name || 'Current Step'}
          </DialogTitle>
        </DialogHeader>
        
        {Object.keys(task.metadata || {}).length > 0 && (
            <div className="bg-gray-50 p-3 rounded-md border text-xs space-y-1 mb-4">
                <p className="font-bold text-gray-500 uppercase mb-2">Case Context</p>
                {Object.entries(task.metadata).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                        <span className="text-gray-600">{k}:</span>
                        <span className="font-medium text-gray-900">{String(v)}</span>
                    </div>
                ))}
            </div>
        )}

        <div className="space-y-4 py-4">
            {currentSchema.length === 0 ? (
                <div className="text-center py-6 text-gray-500 bg-gray-50 rounded border-dashed border-2">
                    No form fields defined for this step.
                    <p className="text-xs mt-1">You can simply proceed.</p>
                </div>
            ) : (
                currentSchema.map(field => (
                    <div key={field.id} className="space-y-1">
                        {field.type !== 'checkbox' && (
                            <label className="text-sm font-medium text-gray-700">
                                {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                        )}
                        {renderField(field)}
                    </div>
                ))
            )}
        </div>

        <Button onClick={handleSubmit} disabled={loading} className="w-full bg-[#0a69a7]">
            {loading ? 'Processing...' : 'Complete Step & Proceed'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}