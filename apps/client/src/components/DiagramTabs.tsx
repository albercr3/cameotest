import React from 'react';
import type { Diagram } from '@cameotest/shared';

interface DiagramTabsProps {
  diagrams: Diagram[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export function DiagramTabs({ diagrams, activeId, onSelect }: DiagramTabsProps) {
  if (diagrams.length === 0) return null;

  return (
    <div className="diagram-tabs" role="tablist" aria-label="Diagrams">
      {diagrams.map((diagram) => (
        <button
          key={diagram.id}
          type="button"
          role="tab"
          aria-selected={diagram.id === activeId}
          className={`diagram-tab${diagram.id === activeId ? ' diagram-tab--active' : ''}`}
          onClick={() => onSelect(diagram.id)}
        >
          <div className="diagram-tab__name">{diagram.name}</div>
          <div className="diagram-tab__type">{diagram.type}</div>
        </button>
      ))}
    </div>
  );
}
