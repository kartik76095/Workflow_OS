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
import { Save, X, MousePointer2, Trash2 } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

const API = "http://localhost:8000/api";

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
        <div className="dndnode border border-[#0a69a7] bg-white p-3 rounded cursor-grab flex items-center gap-2 hover:shadow-md transition-all" onDragStart={(event) => onDragStart(event, 'task')} draggable>
            <div className="w-3 h-3 rounded-full bg-[#0a69a7]"></div>
            Task Node
        </div>
        <div className="dndnode border border-[#48bb78] bg-white p-3 rounded cursor-grab flex items-center gap-2 hover:shadow-md transition-all" onDragStart={(event) => onDragStart(event, 'approval')} draggable>
            <div className="w-3 h-3 rounded-full bg-[#48bb78]"></div>
            Approval
        </div>
        <div className="dndnode border border-[#ed8936] bg-white p-3 rounded cursor-grab flex items-center gap-2 hover:shadow-md transition-all" onDragStart={(event) => onDragStart(event, 'condition')} draggable>
            <div className="w-3 h-3 rounded-full bg-[#ed8936]"></div>
            Condition
        </div>
      </div>
      <div className="mt-auto p-3 bg-gray-50 rounded text-xs text-gray-500">
        💡 Tip: Select a node or connection and press <b>Backspace</b> to delete it.
      </div>
    </aside>
  );
};

// 🎛️ Properties Panel
const PropertiesPanel = ({ selectedNode, onChange, onDelete }) => {
  if (!selectedNode) {
    return (
      <aside className="w-72 bg-white border-l border-gray-200 p-6 text-center">
        <MousePointer2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">Select a node to edit properties</p>
      </aside>
    );
  }

  return (
    <aside className="w-72 bg-white border-l border-gray-200 p-4 flex flex-col gap-4">
      <div className="pb-4 border-b border-gray-100 flex justify-between items-start">
        <div>
            <h3 className="font-semibold text-[#1a202c]">Configuration</h3>
            <p className="text-xs text-gray-500 mt-1">Type: {selectedNode.type}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onDelete(selectedNode.id)} className="text-red-500 hover:bg-red-50">
            <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      
      <div>
        <label className="text-xs font-medium text-gray-700">Label Name</label>
        <Input 
          value={selectedNode.data.label} 
          onChange={(e) => onChange('label', e.target.value)} 
          className="mt-1"
        />
      </div>

      {selectedNode.type === 'approval' && (
        <div>
            <label className="text-xs font-medium text-gray-700">Approver Role</label>
            <Input 
              value={selectedNode.data.approver_role || ''} 
              onChange={(e) => onChange('approver_role', e.target.value)} 
              placeholder="e.g. manager"
              className="mt-1"
            />
        </div>
      )}

       {selectedNode.type === 'condition' && (
        <div>
            <label className="text-xs font-medium text-gray-700">Condition Logic</label>
            <Input 
              value={selectedNode.data.condition || ''} 
              onChange={(e) => onChange('condition', e.target.value)} 
              placeholder="e.g. amount > 5000"
              className="mt-1"
            />
        </div>
      )}
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

  // ✅ CONNECT: Add new connection
  const onConnect = useCallback((params) => 
    setEdges((eds) => addEdge({ ...params, animated: true, updatable: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds)), 
  []);

  // ✅ UPDATE: Allow re-wiring connections by dragging
  const onEdgeUpdate = useCallback(
    (oldEdge, newConnection) => setEdges((els) => updateEdge(oldEdge, newConnection, els)),
    []
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
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

  // Handle Selection
  const onNodeClick = (event, node) => {
    setSelectedNode({ ...node, type: node.dataType || 'task' });
  };

  const onPaneClick = () => {
    setSelectedNode(null);
  };

  // ✅ DELETE: Explicit delete function for the button
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
          node.data = { ...node.data, [key]: value };
          setSelectedNode({ ...node, type: node.dataType || 'task' }); 
        }
        return node;
      })
    );
  };

  const saveWorkflow = async () => {
    if (!workflowName.trim()) {
        toast.error("Please enter a workflow name");
        return;
    }
    if (nodes.length === 0) {
        toast.error("Canvas is empty. Add some nodes!");
        return;
    }

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
        is_active: true
    };

    try {
        await axios.post(`${API}/workflows`, workflowData, {
            headers: { Authorization: `Bearer ${token}` }
        });
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
            <Button variant="ghost" onClick={() => navigate('/workflows')}>
                <X className="w-5 h-5" />
            </Button>
            <Input 
                value={workflowName} 
                onChange={(e) => setWorkflowName(e.target.value)}
                className="text-lg font-semibold border-none focus-visible:ring-0 px-0 w-64"
            />
        </div>
        <Button onClick={saveWorkflow} style={{ backgroundColor: '#0a69a7' }}>
            <Save className="w-4 h-4 mr-2" />
            Save Workflow
        </Button>
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
                    onEdgeUpdate={onEdgeUpdate} // ✅ Allows re-wiring
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    deleteKeyCode={['Backspace', 'Delete']} // ✅ Keyboard delete support
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
                onDelete={onDeleteNode} // ✅ Pass delete function
            />
        </ReactFlowProvider>
      </div>
    </div>
  );
}