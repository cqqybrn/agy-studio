import React, { useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

export interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  testId?: string;
}

export function CopyButton({
  text,
  label = '复制',
  copiedLabel = '已复制',
  className = '',
  testId = 'copy-btn',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-surface-hover hover:text-text-primary focus:outline-none ${className}`}
      title={copied ? copiedLabel : label}
      data-testid={testId}
    >
      {copied ? (
        <>
          <CheckIcon className="h-3 w-3 text-status-success-text" />
          <span className="text-status-success-text">{copiedLabel}</span>
        </>
      ) : (
        <>
          <CopyIcon className="h-3 w-3" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
