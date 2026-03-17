'use client';

import { Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Save, Play } from 'lucide-react';

interface ToolbarButtonProps {
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, label, children }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="
        h-8 w-8
        flex items-center justify-center
        rounded-full
        text-text-secondary
        hover:bg-surface-bg2 hover:text-text-primary
        transition-colors duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
      "
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span aria-hidden="true" className="h-6 w-px bg-border flex-shrink-0" />;
}

interface WorkflowToolbarProps {
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  onSave?: () => void;
  onRun?: () => void;
}

export function WorkflowToolbar({
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  onSave,
  onRun,
}: WorkflowToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Workflow canvas controls"
      className="
        absolute top-4 left-1/2 -translate-x-1/2 z-10
        flex items-center gap-2
        h-12 px-4
        bg-surface-bg0
        shadow-2
        rounded-full
        border border-border
      "
    >
      <ToolbarButton label="Undo" onClick={onUndo}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Redo" onClick={onRedo}>
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton label="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Fit view" onClick={onFitView}>
        <Maximize className="h-4 w-4" />
      </ToolbarButton>

      <Separator />

      <ToolbarButton label="Save workflow" onClick={onSave}>
        <Save className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Run test" onClick={onRun}>
        <Play className="h-4 w-4 text-success-text" />
      </ToolbarButton>
    </div>
  );
}
