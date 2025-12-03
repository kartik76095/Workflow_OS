import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Workflow, Plus, Sparkles, X, GitBranch, Webhook, Copy, Check, Settings, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import WorkflowCanvas from '../components/WorkflowCanvas';

// ✅ FIX 1: Robust API URL definition
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

export default function Workflows({ user }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [webhookTriggers, setWebhookTriggers] = useState([]);
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  
  const navigate = useNavigate();

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

  const deleteWorkflow = async (workflowId, e) => {
    e.stopPropagation(); // Prevent opening the card when clicking delete
    
    if (!window.confirm("Are you sure you want to delete this workflow? This cannot be undone.")) {
        return;
    }

    const token = localStorage.getItem('token');
    try {
        await axios.delete(`${API}/workflows/${workflowId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        toast.success("Workflow deleted successfully");
        fetchWorkflows(); // Refresh list
    } catch (error) {
        toast.error(error.response?.data?.detail || "Failed to delete workflow");
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

  const fetchWebhookTriggers = async (workflowId) => {
    const token = localStorage.getItem('token');
    try {
      const res = await axios.get(`${API}/webhooks/triggers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const filtered = res.data.triggers.filter(t => t.workflow_id === workflowId);
      setWebhookTriggers(filtered);
    } catch (error) {
      console.error('Failed to fetch webhook triggers:', error);
    }
  };

  const createWebhookTrigger = async (workflowId) => {
    setCreatingWebhook(true);
    const token = localStorage.getItem('token');
    try {
      const res = await axios.post(
        `${API}/webhooks/triggers`,
        {
          name: `Webhook for ${selectedWorkflow?.name}`,
          workflow_id: workflowId,
          payload_mapping: {
            data: 'data'
          }
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Webhook trigger created!');
      fetchWebhookTriggers(workflowId);
    } catch (error) {
      if (error.response?.status === 403) {
        toast.error('Webhook triggers require admin privileges');
      } else {
        toast.error('Failed to create webhook trigger');
      }
    } finally {
      setCreatingWebhook(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      toast.success('URL copied to clipboard!');
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      toast.error('Failed to copy URL');
    }
  };

  const openWorkflowDialog = (workflow) => {
    setSelectedWorkflow(workflow);
    setViewDialogOpen(true);
    fetchWebhookTriggers(workflow.id);
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
        <div className="flex gap-3">
            {/* Manual Creation Button */}
            <Button 
                variant="outline" 
                onClick={() => navigate('/workflows/builder')}
            >
                <Plus className="w-4 h-4 mr-2" />
                Create Manually
            </Button>

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
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0a69a7]"></div>
        </div>
      ) : workflows.length === 0 ? (
        <Card className="p-12 text-center">
          <Workflow className="w-16 h-16 mx-auto mb-4 text-[#718096]" />
          <h3 className="text-lg font-semibold text-[#1a202c] mb-2">No workflows yet</h3>
          <p className="text-[#718096] mb-6">Create your first workflow manually or using AI</p>
          <div className="flex justify-center gap-3">
             <Button variant="outline" onClick={() => navigate('/workflows/builder')}>
                <Plus className="w-4 h-4 mr-2" />
                Create Manually
            </Button>
            <Button onClick={() => setAiDialogOpen(true)} style={{ backgroundColor: '#0a69a7' }}>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Workflow
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workflows.map((workflow) => (
            <Card
              key={workflow.id}
              data-testid={`workflow-${workflow.id}`}
              onClick={() => openWorkflowDialog(workflow)}
              className="p-6 bg-white border border-[#e2e8f0] hover:shadow-lg transition-shadow cursor-pointer relative group"
            >
              {/* ✅ DELETE BUTTON: Only visible to Admins */}
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-4 right-4 text-red-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => deleteWorkflow(workflow.id, e)}
                    title="Delete Workflow"
                >
                    <Trash2 className="w-4 h-4" />
                </Button>
              )}

              <div className="flex items-start justify-between mb-4">
                <Workflow className="w-8 h-8 text-[#0a69a7]" />
                {workflow.is_template && (
                  <span className="px-2 py-1 text-xs font-medium bg-[#70bae7]/20 text-[#0a69a7] rounded mr-8">
                    Template
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-[#1a202c] mb-2 pr-8">{workflow.name}</h3>
              <p className="text-sm text-[#718096] mb-4 line-clamp-2">{workflow.description || 'No description'}</p>
              <div className="flex items-center text-xs text-[#718096]">
                <span>{workflow.nodes?.length || 0} nodes</span>
                <span className="mx-2">•</span>
                <span>{workflow.edges?.length || 0} connections</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Workflow Viewer Dialog - (Keep existing dialog code here) */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
         {/* ... Copy the exact same Dialog content from previous file ... */}
         {/* Since I can't leave it empty in a replace block, I am including the full dialog code below */}
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Workflow className="w-6 h-6 mr-2 text-[#0a69a7]" />
              {selectedWorkflow?.name}
            </DialogTitle>
          </DialogHeader>
          
          {selectedWorkflow && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="triggers">
                  <Webhook className="w-4 h-4 mr-2" />
                  Triggers
                </TabsTrigger>
                <TabsTrigger value="config">
                  <Settings className="w-4 h-4 mr-2" />
                  Config
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-[#718096] mb-2">Description</h4>
                  <p className="text-[#1a202c]">{selectedWorkflow.description || 'No description provided'}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-[#718096]">Workflow Diagram</h4>
                    <span className="text-xs text-[#718096] bg-gray-100 px-2 py-1 rounded">Read Only View</span>
                  </div>
                  <WorkflowCanvas 
                    initialNodes={selectedWorkflow.nodes || []} 
                    initialEdges={selectedWorkflow.edges || []}
                    readOnly={true}
                  />
                </div>
              </TabsContent>

              <TabsContent value="triggers" className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-900 mb-2 flex items-center">
                    <Webhook className="w-5 h-5 mr-2" />
                    Webhook Triggers
                  </h4>
                  <p className="text-sm text-blue-700">
                    Create webhook URLs that external systems can call to trigger this workflow automatically.
                  </p>
                </div>

                {webhookTriggers.length > 0 ? (
                  <div className="space-y-3">
                    {webhookTriggers.map((trigger) => (
                      <div key={trigger.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h5 className="font-semibold text-[#1a202c] mb-1">{trigger.name}</h5>
                            <p className="text-xs text-[#718096]">
                              Triggered {trigger.trigger_count} times
                              {trigger.last_triggered && ` • Last: ${new Date(trigger.last_triggered).toLocaleString()}`}
                            </p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded ${trigger.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                            {trigger.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="bg-white p-3 rounded border border-gray-300 font-mono text-xs break-all">
                          {BACKEND_URL}{trigger.hook_url}
                        </div>
                        <div className="flex items-center space-x-2 mt-3">
                          <Button size="sm" onClick={() => copyToClipboard(`${BACKEND_URL}${trigger.hook_url}`)} className="bg-[#0a69a7]">
                            {copiedUrl === `${BACKEND_URL}${trigger.hook_url}` ? <><Check className="w-3 h-3 mr-1" /> Copied!</> : <><Copy className="w-3 h-3 mr-1" /> Copy URL</>}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Webhook className="w-12 h-12 mx-auto text-[#718096] mb-3" />
                    <h5 className="font-semibold text-[#1a202c] mb-2">No webhook triggers yet</h5>
                    <Button onClick={() => createWebhookTrigger(selectedWorkflow.id)} disabled={creatingWebhook} className="bg-[#0a69a7]">
                      {creatingWebhook ? 'Creating...' : '+ Create Webhook Trigger'}
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="config" className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-[#1a202c] mb-2">Workflow Configuration</h4>
                  <div className="space-y-3 text-sm">
                    <div><span className="font-medium text-[#718096]">Workflow ID:</span> <code className="ml-2 px-2 py-1 bg-white rounded text-xs">{selectedWorkflow.id}</code></div>
                    <div><span className="font-medium text-[#718096]">Status:</span> <span className={`ml-2 px-2 py-1 text-xs rounded ${selectedWorkflow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{selectedWorkflow.is_active ? 'Active' : 'Inactive'}</span></div>
                    <div><span className="font-medium text-[#718096]">Created:</span> <span className="ml-2 text-[#1a202c]">{new Date(selectedWorkflow.created_at).toLocaleString()}</span></div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}