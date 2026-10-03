import React from 'react';
import type { ModelPickerProps } from './types';
import type { Model } from '@agy-studio/contracts';

const NO_MODELS: Model[] = [];

export function ModelPicker({
  value,
  onChange,
  models = NO_MODELS,
  disabled = false,
  className = '',
  loading = false,
  fetched = false,
  error = null,
}: ModelPickerProps) {
  const fallbackId = value ?? '';
  const currentValue = value ?? (models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? fallbackId);
  const isEmpty = models.length === 0;
  const placeholder = loading || !fetched ? '加载模型中…' : fallbackId || '暂无可用模型';

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        data-testid="model-picker-select"
        value={currentValue}
        disabled={disabled || (isEmpty && !fallbackId)}
        onChange={(e) => onChange?.(e.target.value)}
        title={error ?? '选择模型'}
        className="appearance-none rounded-md border border-border-default bg-bg-surface px-2.5 py-1 pr-6 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        aria-label="选择模型"
      >
        {isEmpty && <option value={fallbackId}>{placeholder}</option>}
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
