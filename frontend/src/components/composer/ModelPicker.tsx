import React from 'react';
import type { ModelPickerProps } from './types';
import type { Model } from '@agy-studio/contracts';

const DEFAULT_MODELS: Model[] = [
  { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', group: 'third_party', isDefault: true },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'gemini', isDefault: false },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'gemini', isDefault: false },
  { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', group: 'third_party', isDefault: false },
];

export function ModelPicker({
  value,
  onChange,
  models = DEFAULT_MODELS,
  disabled = false,
  className = '',
}: ModelPickerProps) {
  const currentValue = value ?? (models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? '');

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        data-testid="model-picker-select"
        value={currentValue}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="appearance-none rounded-md border border-border-default bg-bg-surface px-2.5 py-1 pr-6 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        aria-label="选择模型"
      >
        {models.map((model) => (
          <option key={model.id} value={model.id} className="bg-bg-panel text-text-primary">
            {model.label}
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
