import React from 'react';
import type { ModePickerProps } from './types';
import type { AgentMode } from '@agy-studio/contracts';

const DEFAULT_MODES: { value: AgentMode; label: string }[] = [
  { value: 'code', label: 'Code' },
  { value: 'architect', label: 'Architect' },
  { value: 'ask', label: 'Ask' },
];

export function ModePicker({
  value = 'code',
  onChange,
  modes,
  disabled = false,
  className = '',
}: ModePickerProps) {
  const current = value ?? 'code';
  const modeList = modes ? modes.map((m) => ({ value: m, label: m })) : DEFAULT_MODES;

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        data-testid="mode-picker-select"
        value={current}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="appearance-none rounded-md border border-border-default bg-bg-surface px-2.5 py-1 pr-6 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer capitalize"
        aria-label="选择智能体模式"
      >
        {modeList.map((m) => (
          <option key={m.value} value={m.value} className="bg-bg-panel text-text-primary">
            {`Mode: ${m.label}`}
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
