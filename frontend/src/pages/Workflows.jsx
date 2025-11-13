import { useState, useEffect } from 'react';
import axios from 'axios';
import { Workflow, Plus, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Workflows() {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/workflows`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setWorkflows(res.data.workflows || []);
    } catch (error) {
      toast.error('Failed to fetch workflows');
    } finally {
      setLoading(false);
    }
  };

  const generateWorkflow = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please describe the workflow you want to create');
      return;
    }

    setGenerating(true);
    const token = localStorage.getItem('token');
    try {
      const res = await axios.post(
        `${API}/ai/generate-workflow`,
        { description: aiPrompt },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const workflowData = {
        name: res.data.workflow.workflow_name || 'AI Generated Workflow',
        description: aiPrompt,
        nodes: res.data.workflow.nodes || [],
        edges: res.data.workflow.edges || [],
      };

      await axios.post(`${API}/workflows`, workflowData, {
        headers: { Authorization: `Bearer ${token}` },
      });

      toast.success('Workflow generated successfully!');
      setAiDialogOpen(false);
      setAiPrompt('');
      fetchWorkflows();
    } catch (error) {
      toast.error('Failed to generate workflow');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div data-testid="workflows-page" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-[#1a202c]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Workflows
          </h1>
          <p className="text-[#718096] mt-2">Create and manage workflow automations</p>
        </div>
        <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="generate-workflow-button" style={{ backgroundColor: '#0a69a7' }}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate with AI
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate Workflow with AI</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <p className="text-sm text-[#718096]">
                Describe the workflow you want to create, and our AI will generate it for you.
              </p>
              <textarea
                data-testid="ai-workflow-prompt"
                className="w-full px-3 py-2 border border-[#e2e8f0] rounded-md"
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Example: Create a workflow for invoice approval that requires finance review, then manager approval if amount exceeds $5000"
              />
              <Button
                data-testid="generate-button"
                onClick={generateWorkflow}
                disabled={generating}
                className="w-full"
                style={{ backgroundColor: '#0a69a7' }}
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Workflow
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0a69a7]"></div>
        </div>
      ) : workflows.length === 0 ? (
        <Card className="p-12 text-center">
          <Workflow className="w-16 h-16 mx-auto mb-4 text-[#718096]" />
          <h3 className="text-lg font-semibold text-[#1a202c] mb-2">No workflows yet</h3>
          <p className="text-[#718096] mb-6">Create your first workflow using AI</p>
          <Button onClick={() => setAiDialogOpen(true)} style={{ backgroundColor: '#0a69a7' }}>
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Workflow
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workflows.map((workflow) => (
            <Card
              key={workflow.id}
              className="p-6 bg-white border border-[#e2e8f0] hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div className="flex items-start justify-between mb-4">
                <Workflow className="w-8 h-8 text-[#0a69a7]" />
                {workflow.is_template && (
                  <span className="px-2 py-1 text-xs font-medium bg-[#70bae7]/20 text-[#0a69a7] rounded">
                    Template
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-[#1a202c] mb-2">{workflow.name}</h3>
              <p className="text-sm text-[#718096] mb-4">{workflow.description || 'No description'}</p>
              <div className="flex items-center text-xs text-[#718096]">
                <span>{workflow.nodes?.length || 0} nodes</span>
                <span className="mx-2">•</span>
                <span>{workflow.edges?.length || 0} connections</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
