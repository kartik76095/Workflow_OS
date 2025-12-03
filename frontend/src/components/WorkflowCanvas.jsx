import React, { useCallback, useEffect } from 'react';
import ReactFlow, { 
  Background, 
  Controls, 
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Node Styles (Tailwind colors)
const nodeStyles = {
  task: { background: '#fff', border: '1px solid #0a69a7', borderRadius: '8px', padding: '10px', minWidth: '150px', color: '#1a202c' },
  condition: { background: '#fffbf0', border: '1px solid #ed8936', borderRadius: '4px', padding: '10px', transform: 'rotate(0deg)', color: '#c05621' },
  approval: { background: '#f0fff4', border: '1px solid #48bb78', borderRadius: '8px', padding: '10px', color: '#22543d' },
  webhook_action: { background: '#e6fffa', border: '1px solid #38b2ac', borderRadius: '8px', padding: '10px', color: '#234e52' },
  ai_worker: { background: '#faf5ff', border: '1px solid #805ad5', borderRadius: '8px', padding: '10px', color: '#553c9a' }
};

const getNodeStyle = (type) => nodeStyles[type] || nodeStyles.task;

export default function WorkflowCanvas({ initialNodes = [], initialEdges = [], onSave, readOnly = false }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    // Transform DB nodes to ReactFlow nodes if needed
    if (initialNodes.length > 0) {
        const flowNodes = initialNodes.map(node => ({
        id: node.id,
        type: 'default', 
        data: { label: node.label },
        position: node.position || { x: 0, y: 0 },
        style: getNodeStyle(node.type),
        }));
        setNodes(flowNodes);
    }

    // Transform DB edges to ReactFlow edges
    if (initialEdges.length > 0) {
        const flowEdges = initialEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        style: { stroke: '#718096' },
        markerEnd: { type: MarkerType.ArrowClosed },
        }));
        setEdges(flowEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onConnect = useCallback((params) => {
    if (readOnly) return;
    setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [readOnly, setEdges]);

  return (
    <div className="h-[600px] w-full border border-gray-200 rounded-lg bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onConnect={onConnect}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#aaa" gap={16} />
        <Controls />
        <MiniMap 
          nodeStrokeColor={(n) => '#0a69a7'}
          nodeColor={(n) => '#fff'}
        />
      </ReactFlow>
    </div>
  );
}