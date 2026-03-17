'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, Bot, GitBranch, Play, Plug, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type NodeType = 'trigger' | 'agent' | 'condition' | 'action' | 'integration' | 'delay';
type NodeStatus = 'active' | 'idle' | 'error';

interface WorkflowNodeData {
  label: string;
  subtitle?: string;
  nodeType: NodeType;
  status?: NodeStatus;
  [key: string]: unknown;
}

const NODE_ICON: Record<NodeType, typeof Zap> = {
  trigger: Zap,
  agent: Bot,
  condition: GitBranch,
  action: Play,
  integration: Plug,
  delay: Clock,
};

const NODE_ACCENT: Record<NodeType, string> = {
  trigger: 'border-l-accent-500 bg-accent-50',
  agent: 'border-l-accent-500 bg-accent-50',
  condition: 'border-l-info-solid bg-info-subtle-bg',
  action: 'border-l-success-solid bg-success-subtle-bg',
  integration: 'border-l-warning-solid bg-warning-subtle-bg',
  delay: 'border-l-text-tertiary bg-surface-bg2',
};

const ICON_COLOR: Record<NodeType, string> = {
  trigger: 'text-accent-600',
  agent: 'text-accent-600',
  condition: 'text-info-text',
  action: 'text-success-text',
  integration: 'text-warning-text',
  delay: 'text-text-tertiary',
};

const STATUS_DOT: Record<NodeStatus, string> = {
  active: 'bg-success-solid',
  idle: 'bg-surface-bg3',
  error: 'bg-danger-solid',
};

export function WorkflowNode({ data }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const { label, subtitle, nodeType, status } = nodeData;

  const Icon = NODE_ICON[nodeType] ?? Zap;
  const accentClass = NODE_ACCENT[nodeType] ?? 'border-l-text-tertiary';
  const iconColor = ICON_COLOR[nodeType] ?? 'text-text-tertiary';
  const statusDotClass = status ? STATUS_DOT[status] : undefined;

  return (
    <div
      className={cn(
        'relative min-w-[220px] max-w-[280px]',
        'bg-surface-bg0 shadow-2 rounded-lg',
        'border-l-[3px] border border-border-subtle',
        accentClass.split(' ')[0], // only border-l color
        'transition-shadow duration-200 hover:shadow-3',
      )}
    >
      {/* Target handle — left side */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-accent-500 !bg-white"
      />

      <div className="p-4">
        {/* Header row: icon + status */}
        <div className="flex items-center justify-between mb-2">
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accentClass.split(' ')[1] || 'bg-surface-bg2')}>
            <Icon className={cn('h-4 w-4', iconColor)} />
          </div>
          {statusDotClass && (
            <span
              aria-label={`Status: ${status}`}
              className={cn('h-2.5 w-2.5 rounded-full ring-2 ring-white', statusDotClass)}
            />
          )}
        </div>

        {/* Label */}
        <p className="text-sm font-semibold text-text-primary leading-snug">{label}</p>

        {/* Subtitle */}
        {subtitle && (
          <p className="mt-0.5 text-xs text-text-tertiary leading-relaxed">{subtitle}</p>
        )}
      </div>

      {/* Source handle — right side */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-accent-500 !bg-white"
      />
    </div>
  );
}
