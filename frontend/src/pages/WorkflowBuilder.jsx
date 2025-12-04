import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  updateEdge,
  Controls,
  Background,
  MiniMap,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Save, X, MousePointer2, GripVertical, Trash2, Plus, Settings } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const API = `${BACKEND_URL}/api`;

// 🎨 Node Styling
const nodeStyles = {
  task: { background: '#fff', border: '1px solid #0a69a7', borderRadius: '8px', padding: '10px', minWidth: '150px' },
  approval: { background: '#f0fff4', border: '1px solid #48bb78', borderRadius: '8px', padding: '10px' },
  condition: { background: '#fffbf0', border: '1px solid #ed8936', borderRadius: '4px', padding: '10px' }
};

const getNodeStyle = (type) => nodeStyles[type] || nodeStyles.task;

// 🔧 Sidebar Component
const Sidebar = () => {
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-4">
      <h3 className="font-semibold text-[#1a202c]">Tools</h3>
      <div className="space-y-3">
        <div className="text-xs font-medium text-gray-500 uppercase">Nodes</div>
        {['task', 'approval', 'condition'].map(type => (
            <div key={type} className="dndnode border bg-white p-3 rounded cursor-grab flex items-center gap-2 hover:shadow-md transition-all" 
                 style={{borderColor: type === 'task' ? '#0a69a7' : type === 'approval' ? '#48bb78' : '#ed8936'}}
                 onDragStart={(event) => onDragStart(event, type)} draggable>
                <div className={`w-3 h-3 rounded-full ${type === 'task' ? 'bg-[#0a69a7]' : type === 'approval' ? 'bg-[#48bb78]' : 'bg-[#ed8936'}`}></div>
                {type.charAt(0).toUpperCase() + type.slice(1)} Node
            </div>
        ))}
      </div>
      <div className="mt-auto p-3 bg-gray-50 rounded text-xs text-gray-500">
        💡 <b>Tip:</b> Click the canvas background to add <b>Global Fields</b> (Data). Click a node to rename it.
      </div>
    </aside>
  );
};

// 🎛️ Properties Panel (Restricted Field Access)
const PropertiesPanel = ({ selectedNode, onChange, onDelete, globalSchema, setGlobalSchema }) => {
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false, options: '' });

  // We ONLY allow editing schema if NO node is selected (Global Mode)
  const isGlobalMode = !selectedNode;
  const targetSchema = isGlobalMode ? globalSchema : [];

  const handleAddField = () => {
    if (!newField.label) return;
    
    const fieldToAdd = { 
        ...newField, 
        id: `field_${Date.now()}`,
        options: newField.type === 'select' ? newField.options.split(',').map(s => s.trim()) : []
    };
    
    setGlobalSchema([...globalSchema, fieldToAdd]);
    setNewField({ label: '', type: 'text', required: false, options: '' });
  };

  const removeField = (fieldId) => {
    setGlobalSchema(globalSchema.filter(f => f.id !== fieldId));
  };

  return (
    <aside className="w-96 bg-white border-l border-gray-200 flex flex-col h-full shadow-xl z-10">
      <div className={`p-4 border-b border-gray-100 flex justify-between items-center ${isGlobalMode ? 'bg-blue-50' : 'bg-gray-50'}`}>
        <div>
            <h3 className="font-bold text-[#1a202c]">
                {isGlobalMode ? "Global Data Schema" : "Step Configuration"}
            </h3>
            <p className="text-xs text-gray-500">
                {isGlobalMode ? "Define fields for the entire workflow" : `${selectedNode.type.toUpperCase()} Node`}
            </p>
        </div>
        {!isGlobalMode && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(selectedNode.id)} className="text-red-500 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
            </Button>
        )}
      </div>
      
      <div className="p-4 overflow-y-auto flex-1 space-y-6">
        
        {/* NODE SELECTED: Show General Settings Only */}
        {!isGlobalMode && (
            <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-gray-400 tracking-wider">General Settings</label>
                <div>
                    <label className="text-xs font-medium text-gray-700">Step Name</label>
                    <Input 
                    value={selectedNode.data.label} 
                    onChange={(e) => onChange('label', e.target.value)} 
                    className="mt-1"
                    />
                </div>
                
                <div className="p-3 bg-blue-50 rounded border border-blue-100 text-xs text-blue-800 mt-4">
                    <Settings className="w-4 h-4 inline mr-1" />
                    To add data fields, click the <b>canvas background</b> to edit the Global Workflow Schema.
                </div>
            </div>
        )}

        {/* NO NODE SELECTED: Show Global Field Builder */}
        {isGlobalMode && (
            <div className="space-y-4">
                 <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-gray-400 tracking-wider">
                        Data Fields
                    </label>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {targetSchema.length} Fields
                    </span>
                 </div>
                 
                 {/* Field List */}
                 <div className="space-y-2">
                    {targetSchema.map((field) => (
                        <div key={field.id} className="bg-white p-3 rounded border border-gray-200 flex justify-between items-center shadow-sm">
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium text-gray-800">{field.label}</p>
                                    {field.required && <span className="text-[10px] text-red-500 font-bold">*</span>}
                                </div>
                                <p className="text-[10px] text-gray-500 uppercase">{field.type}</p>
                            </div>
                            <button onClick={() => removeField(field.id)} className="text-gray-400 hover:text-red-500">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {targetSchema.length === 0 && (
                        <div className="text-center py-6 border-2 border-dashed border-gray-100 rounded-lg text-gray-400 text-xs">
                            No global fields yet. Add fields like 'Document ID', 'Client Name', etc.
                        </div>
                    )}
                 </div>

                 {/* Add New Field Form */}
                 <div className="bg-[#eff2f5] p-3 rounded-lg space-y-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-700">Add New Field</p>
                    <Input 
                        placeholder="Label (e.g. Case ID)" 
                        value={newField.label}
                        onChange={(e) => setNewField({...newField, label: e.target.value})}
                        className="bg-white h-8 text-sm"
                    />
                    <div className="flex gap-2">
                        <select 
                            className="flex-1 h-8 rounded-md border border-input bg-white px-2 text-xs"
                            value={newField.type}
                            onChange={(e) => setNewField({...newField, type: e.target.value})}
                        >
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="select">Dropdown</option>
                            <option value="checkbox">Checkbox</option>
                        </select>
                        <div className="flex items-center gap-1 bg-white px-2 rounded border border-input">
                            <input type="checkbox" id="req" checked={newField.required} onChange={(e) => setNewField({...newField, required: e.target.checked})} />
                            <label htmlFor="req" className="text-xs cursor-pointer">Req</label>
                        </div>
                    </div>
                    {newField.type === 'select' && (
                        <Input placeholder="Options (comma separated)" value={newField.options} onChange={(e) => setNewField({...newField, options: e.target.value})} className="bg-white h-8 text-sm" />
                    )}
                    <Button size="sm" onClick={handleAddField} className="w-full bg-[#0a69a7] h-8 text-xs">
                        <Plus className="w-3 h-3 mr-1" /> Add Global Field
                    </Button>
                 </div>
            </div>
        )}
      </div>
    </aside>
  );
};

export default function WorkflowBuilder() {
  const reactFlowWrapper = useRef(null);
  const navigate = useNavigate();
  
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [globalSchema, setGlobalSchema] = useState([]);

  const onConnect = useCallback((params) => 
    setEdges((eds) => addEdge({ ...params, animated: true, updatable: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds)), 
  []);

  const onEdgeUpdate = useCallback((oldEdge, newConnection) => setEdges((els) => updateEdge(oldEdge, newConnection, els)), []);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;
      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode = {
        id: `node_${Date.now()}`,
        type: 'default', 
        position,
        data: { label: `${type} Node` },
        style: getNodeStyle(type),
        dataType: type 
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance],
  );

  const onNodeClick = (event, node) => {
    setSelectedNode({ ...node, type: node.dataType || 'task' });
  };

  const onPaneClick = () => {
    setSelectedNode(null);
  };

  const onDeleteNode = (nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  };

  const updateNodeData = (key, value) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === selectedNode.id) {
          return { ...node, data: { ...node.data, [key]: value } };
        }
        return node;
      })
    );
    setSelectedNode(prev => ({ ...prev, data: { ...prev.data, [key]: value } }));
  };

  const saveWorkflow = async () => {
    if (!workflowName.trim()) return toast.error("Enter workflow name");
    if (nodes.length === 0) return toast.error("Canvas is empty");

    const token = localStorage.getItem('token');
    const formattedNodes = nodes.map(n => ({
        id: n.id,
        type: n.dataType || 'task',
        label: n.data.label,
        position: n.position,
        data: n.data
    }));

    const workflowData = {
        name: workflowName,
        description: "Created manually via Workflow Builder",
        nodes: formattedNodes,
        edges: edges,
        is_active: true,
        global_schema: globalSchema
    };

    try {
        await axios.post(`${API}/workflows`, workflowData, { headers: { Authorization: `Bearer ${token}` } });
        toast.success("Workflow saved successfully!");
        navigate('/workflows');
    } catch (error) {
        toast.error("Failed to save workflow");
    }
  };

  return (
    <div className="h-screen flex flex-col bg-white">
      <div className="h-16 border-b border-gray-200 px-6 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/workflows')}><X className="w-5 h-5" /></Button>
            <Input value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} className="text-lg font-semibold border-none px-0 w-64" />
        </div>
        <Button onClick={saveWorkflow} style={{ backgroundColor: '#0a69a7' }}><Save className="w-4 h-4 mr-2" /> Save Workflow</Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <ReactFlowProvider>
            <Sidebar />
            <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onEdgeUpdate={onEdgeUpdate}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    deleteKeyCode={['Backspace', 'Delete']}
                    fitView
                >
                    <Background color="#aaa" gap={16} />
                    <Controls />
                    <MiniMap nodeStrokeColor="#0a69a7" />
                </ReactFlow>
            </div>
            <PropertiesPanel 
                selectedNode={selectedNode} 
                onChange={updateNodeData}
                onDelete={onDeleteNode}
                globalSchema={globalSchema} 
                setGlobalSchema={setGlobalSchema}
            />
        </ReactFlowProvider>
      </div>
    </div>
  );
}