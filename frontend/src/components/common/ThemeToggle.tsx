import React from 'react';
import type { ThemePreference } from '../../theme';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; title: string }> = [
  { value: 'light', label: '浅色', title: '浅色主题' },
  { value: 'dark', label: '深色', title: '深色主题' },
  { value: 'system', label: '系统', title: '跟随系统外观' },
];

export interface ThemeToggleProps {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
  className?: string;
}

export function ThemeToggle({ value, onChange, className = '' }: ThemeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className={`flex items-center rounded-lg border border-border-default bg-bg-app p-0.5 ${className}`}
      data-testid="theme-toggle"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              selected
                ? 'bg-bg-surface-active font-medium text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
            data-testid={`theme-option-${option.value}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
