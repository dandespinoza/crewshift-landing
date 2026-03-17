'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  type Node,
  type Edge,
  type OnConnect,
} from '@xyflow/react';

import { WorkflowNode } from './workflow-node';

const nodeTypes = {
  custom: WorkflowNode,
};

const EDGE_STYLE = { stroke: '#FF751F', strokeWidth: 2 };

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'custom',
    position: { x: 80, y: 180 },
    data: {
      label: 'Job Completed',
      subtitle: 'Trigger event',
      nodeType: 'trigger',
      status: 'active',
    },
  },
  {
    id: '2',
    type: 'custom',
    position: { x: 420, y: 120 },
    data: {
      label: 'Invoice Agent',
      subtitle: 'Generate invoice draft',
      nodeType: 'agent',
      status: 'active',
    },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 760, y: 180 },
    data: {
      label: 'Send to Customer',
      subtitle: 'Email / SMS delivery',
      nodeType: 'action',
      status: 'idle',
    },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 420, y: 320 },
    data: {
      label: 'Needs Review?',
      subtitle: 'Check auto-approval',
      nodeType: 'condition',
      status: 'active',
    },
  },
  {
    id: '5',
    type: 'custom',
    position: { x: 760, y: 380 },
    data: {
      label: 'Notify Owner',
      subtitle: 'Push notification',
      nodeType: 'action',
      status: 'idle',
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    animated: true,
    style: EDGE_STYLE,
    type: 'smoothstep',
  },
  {
    id: 'e1-4',
    source: '1',
    target: '4',
    animated: true,
    style: EDGE_STYLE,
    type: 'smoothstep',
  },
  {
    id: 'e2-3',
    source: '2',
    target: '3',
    animated: true,
    style: EDGE_STYLE,
    type: 'smoothstep',
  },
  {
    id: 'e4-5',
    source: '4',
    target: '5',
    animated: true,
    style: { ...EDGE_STYLE, stroke: '#3B82F6' },
    type: 'smoothstep',
    label: 'Yes',
    labelStyle: { fill: '#6B6B76', fontSize: 11, fontWeight: 500 },
  },
  {
    id: 'e4-2',
    source: '4',
    target: '2',
    style: { ...EDGE_STYLE, stroke: '#22C55E', strokeDasharray: '6 3' },
    type: 'smoothstep',
    label: 'No → Auto-approve',
    labelStyle: { fill: '#6B6B76', fontSize: 11, fontWeight: 500 },
  },
];

export function WorkflowCanvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect: OnConnect = useCallback(
    (connection) => setEdges((eds) => addEdge({ ...connection, animated: true, style: EDGE_STYLE, type: 'smoothstep' }, eds)),
    [setEdges],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.4, maxZoom: 0.85 }}
        style={{ background: '#1A1A1E' }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          color="#2a2a2e"
          size={1}
        />
        <Controls
          className="!bg-surface-bg0 !shadow-2 !rounded-lg !border !border-border-subtle overflow-hidden [&>button]:!bg-surface-bg0 [&>button]:!border-border-subtle [&>button:hover]:!bg-surface-bg2 [&>button>svg]:!fill-text-secondary"
        />
        <MiniMap
          nodeColor="#FF751F"
          maskColor="rgba(26,26,30,0.7)"
          style={{ background: '#111113', borderRadius: '8px', border: '1px solid #1E1E22' }}
        />
      </ReactFlow>
    </div>
  );
}
