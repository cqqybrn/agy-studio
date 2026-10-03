import React from 'react';

export type StatusType =
  | 'running'
  | 'succeeded'
  | 'success'
  | 'failed'
  | 'error'
  | 'idle'
  | 'warning'
  | 'stalled'
  | 'queued'
  | 'starting'
  | 'completed'
  | 'aborted';

export interface StatusDotProps {
  status: StatusType | string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

export function StatusDot({
  status,
  size = 'md',
  className = '',
  title,
}: StatusDotProps) {
  const normStatus = status.toLowerCase();

  const sizeClasses = {
    sm: 'h-1.5 w-1.5',
    md: 'h-2 w-2',
    lg: 'h-2.5 w-2.5',
  }[size];

  const containerSizes = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4',
  }[size];

  const displayTitle = title || `Status: ${status}`;

  if (normStatus === 'running' || normStatus === 'starting') {
    return (
      <span
        className={`relative inline-flex items-center justify-center ${containerSizes} ${className}`}
        title={displayTitle}
        data-testid="status-dot-running"
      >
        <span className={`absolute inline-flex ${sizeClasses} rounded-full bg-accent opacity-75 animate-ping`} />
        <span className={`relative inline-flex rounded-full ${sizeClasses} bg-accent`} />
      </span>
    );
  }

  let colorClass = 'bg-text-tertiary'; // default gray / idle
  if (normStatus === 'succeeded' || normStatus === 'success' || normStatus === 'completed') {
    colorClass = 'bg-status-success'; // success emerald
  } else if (normStatus === 'failed' || normStatus === 'error') {
    colorClass = 'bg-status-error'; // error red
  } else if (normStatus === 'warning' || normStatus === 'stalled') {
    colorClass = 'bg-status-warning'; // warning amber
  } else if (normStatus === 'aborted') {
    colorClass = 'bg-text-tertiary border border-border-strong';
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${containerSizes} ${className}`}
      title={displayTitle}
      data-testid={`status-dot-${normStatus}`}
    >
      <span className={`rounded-full ${sizeClasses} ${colorClass} transition-colors`} />
    </span>
  );
}
