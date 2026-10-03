import React from 'react';
import { fileExtension } from '../../../domain/toolLabels';

const FAMILIES: Array<{ exts: string[]; className: string }> = [
  { exts: ['ts', 'tsx', 'mts', 'cts'], className: 'bg-status-info-subtle text-status-info-text' },
  { exts: ['js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'pyw'], className: 'bg-status-warning-subtle text-status-warning-text' },
  { exts: ['css', 'scss', 'less', 'html', 'vue', 'svelte'], className: 'bg-accent-subtle text-accent' },
  { exts: ['go', 'rs', 'java', 'kt', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift'], className: 'bg-status-success-subtle text-status-success-text' },
  { exts: ['sh', 'ps1', 'bat', 'cmd', 'bash', 'zsh'], className: 'bg-status-error-subtle text-status-error-text' },
];

/** Small extension badge standing in for a language icon; colours come from theme tokens only. */
export function FileTypeIcon({ path, className = '' }: { path: string; className?: string }) {
  const ext = fileExtension(path);
  const family = FAMILIES.find((f) => f.exts.includes(ext));
  const label = (ext || 'f').slice(0, 2).toUpperCase();
  return (
    <span
      className={`inline-flex h-3.5 min-w-[14px] shrink-0 items-center justify-center rounded-sm px-0.5 font-mono text-[8px] font-bold leading-none ${
        family?.className ?? 'bg-bg-surface-active text-text-tertiary'
      } ${className}`}
      aria-hidden="true"
      data-testid="file-type-icon"
    >
      {label}
    </span>
  );
}
