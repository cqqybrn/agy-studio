import React from 'react';
import type { EffortPickerProps } from './types';
import type { Effort } from '@agy-studio/contracts';

const EFFORT_OPTIONS: { value: Effort; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: '轻度思考，快速响应' },
  { value: 'medium', label: 'Medium', description: '平衡响应与推理' },
  { value: 'high', label: 'High', description: '深度思考，多步规划' },
  { value: 'max', label: 'Max', description: '最大推理深度' },
];

export function EffortPicker({
  value = 'medium',
  onChange,
  disabled = false,
  className = '',
}: EffortPickerProps) {
  const current = value ?? 'medium';

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        data-testid="effort-picker-select"
        value={current}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value as Effort)}
        className="appearance-none rounded-md border border-border-default bg-bg-surface px-2.5 py-1 pr-6 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        aria-label="选择思考深度"
      >
        {EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-bg-panel text-text-primary">
            {`Effort: ${opt.label}`}
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
