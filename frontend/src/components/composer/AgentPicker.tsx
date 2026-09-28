import React from 'react';
import type { AgentInfo } from '@agy-studio/contracts';
import type { AgentPickerProps } from './types';

export const DEFAULT_AGENT_ID = 'default';

const DEFAULT_AGENTS: AgentInfo[] = [
  { id: DEFAULT_AGENT_ID, name: 'Default agent', description: null, scope: 'builtin' },
];

export function AgentPicker({
  value,
  onChange,
  agents = DEFAULT_AGENTS,
  disabled = false,
  className = '',
}: AgentPickerProps) {
  const current = value ?? DEFAULT_AGENT_ID;
  const base = agents.length > 0 ? agents : DEFAULT_AGENTS;
  // Keep a preselected agent visible until (or unless) the loaded list contains it
  const list = base.some((a) => a.id === current)
    ? base
    : [...base, { id: current, name: current, description: null, scope: 'workspace' as const }];

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        data-testid="agent-picker-select"
        value={current}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="appearance-none rounded-md border border-border-default bg-bg-surface px-2.5 py-1 pr-6 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        aria-label="选择智能体"
      >
        {list.map((agent) => (
          <option
            key={`${agent.scope}:${agent.id}`}
            value={agent.id}
            title={agent.description ?? undefined}
            className="bg-bg-panel text-text-primary"
          >
            {`Agent: ${agent.name}`}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-1.5 text-text-tertiary">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
}
