import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Workflow, Plus, Sparkles, X, GitBranch, Webhook, Copy, Check, Settings } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function Workflows() {
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
              data-testid={`workflow-${workflow.id}`}
              onClick={() => {
                setSelectedWorkflow(workflow);
                setViewDialogOpen(true);
              }}
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

      {/* Workflow Viewer Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Workflow className="w-6 h-6 mr-2 text-[#0a69a7]" />
              {selectedWorkflow?.name}
            </DialogTitle>
          </DialogHeader>
          
          {selectedWorkflow && (
            <div className="space-y-6 mt-4">
              {/* Description */}
              <div>
                <h4 className="text-sm font-medium text-[#718096] mb-2">Description</h4>
                <p className="text-[#1a202c]">{selectedWorkflow.description || 'No description provided'}</p>
              </div>

              {/* Workflow Nodes */}
              <div>
                <h4 className="text-sm font-medium text-[#718096] mb-3">Workflow Steps</h4>
                <div className="space-y-3">
                  {selectedWorkflow.nodes && selectedWorkflow.nodes.length > 0 ? (
                    selectedWorkflow.nodes.map((node, idx) => (
                      <div
                        key={node.id}
                        className="flex items-start p-4 bg-[#eff2f5] rounded-lg border-l-4"
                        style={{
                          borderLeftColor: 
                            node.type === 'task' ? '#0a69a7' :
                            node.type === 'approval' ? '#48bb78' :
                            node.type === 'condition' ? '#ed8936' :
                            '#718096'
                        }}
                      >
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white flex items-center justify-center font-semibold text-sm mr-3">
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center mb-1">
                            <h5 className="font-semibold text-[#1a202c]">{node.label}</h5>
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded capitalize"
                              style={{
                                backgroundColor: 
                                  node.type === 'task' ? '#bee3f8' :
                                  node.type === 'approval' ? '#c6f6d5' :
                                  node.type === 'condition' ? '#feebc8' :
                                  '#e2e8f0',
                                color:
                                  node.type === 'task' ? '#2c5282' :
                                  node.type === 'approval' ? '#22543d' :
                                  node.type === 'condition' ? '#c05621' :
                                  '#4a5568'
                              }}
                            >
                              {node.type}
                            </span>
                          </div>
                          {node.data && Object.keys(node.data).length > 0 && (
                            <p className="text-sm text-[#718096]">
                              {JSON.stringify(node.data)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[#718096] text-center py-4">No workflow steps defined</p>
                  )}
                </div>
              </div>

              {/* Connections */}
              {selectedWorkflow.edges && selectedWorkflow.edges.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[#718096] mb-3">Connections</h4>
                  <div className="space-y-2">
                    {selectedWorkflow.edges.map((edge) => {
                      const sourceNode = selectedWorkflow.nodes?.find(n => n.id === edge.source);
                      const targetNode = selectedWorkflow.nodes?.find(n => n.id === edge.target);
                      return (
                        <div key={edge.id} className="flex items-center text-sm text-[#1a202c] p-3 bg-[#eff2f5] rounded">
                          <span className="font-medium">{sourceNode?.label || edge.source}</span>
                          <GitBranch className="w-4 h-4 mx-2 text-[#718096]" />
                          <span className="font-medium">{targetNode?.label || edge.target}</span>
                          {edge.label && (
                            <span className="ml-2 text-xs text-[#718096]">({edge.label})</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Rules */}
              {selectedWorkflow.rules && selectedWorkflow.rules.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-[#718096] mb-3">Automation Rules</h4>
                  <div className="space-y-2">
                    {selectedWorkflow.rules.map((rule, idx) => (
                      <div key={idx} className="p-3 bg-[#eff2f5] rounded">
                        <p className="text-sm font-medium text-[#1a202c]">{rule.condition}</p>
                        <p className="text-xs text-[#718096] mt-1">Action: {rule.action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="pt-4 border-t border-[#e2e8f0]">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[#718096]">Status</p>
                    <p className="font-medium text-[#1a202c]">
                      {selectedWorkflow.is_active ? '✅ Active' : '⏸️ Inactive'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#718096]">Type</p>
                    <p className="font-medium text-[#1a202c]">
                      {selectedWorkflow.is_template ? '📋 Template' : '🔄 Workflow'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
