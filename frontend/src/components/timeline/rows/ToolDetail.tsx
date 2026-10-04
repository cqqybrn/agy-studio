import React from 'react';
import type { ToolCall } from '@agy-studio/contracts';
import { toolCategory } from '../../../domain/toolLabels';

function DiffLines({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, idx) => {
        let lineClass = '';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          lineClass = 'bg-status-success-subtle text-status-success-text';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          lineClass = 'bg-status-error-subtle text-status-error-text';
        } else if (line.startsWith('@@')) {
          lineClass = 'text-accent';
        }
        return (
          <div key={idx} className={`px-1 ${lineClass}`}>
            {line || ' '}
          </div>
        );
      })}
    </>
  );
}

function stringInput(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

const PRE = 'max-h-72 overflow-auto whitespace-pre-wrap break-all p-2.5 font-mono text-xs leading-relaxed text-text-secondary';

/** Expanded body of a tool row: command output, edit diff, or the raw tool output. */
export function ToolDetail({ tool }: { tool: ToolCall }) {
  const category = toolCategory(tool.kind);
  const output = tool.output ?? '';

  let body: React.ReactNode;
  if (category === 'command') {
    body = (
      <pre className={PRE}>
        <div className="text-text-tertiary">
          <span className="select-none">$ </span>
          {tool.target ?? tool.name}
        </div>
        {output && <div className="mt-1">{output}</div>}
        {!output && tool.status === 'running' && (
          <div className="mt-1 italic text-text-tertiary">Running…</div>
        )}
      </pre>
    );
  } else if (category === 'edit') {
    const patch = stringInput(tool.input, 'patch') ?? stringInput(tool.input, 'diff');
    const oldText = stringInput(tool.input, 'old_string');
    const newText = stringInput(tool.input, 'new_string');
    if (patch) {
      body = (
        <pre className={PRE}>
          <DiffLines text={patch} />
        </pre>
      );
    } else if (oldText !== null || newText !== null) {
      body = (
        <pre className={PRE}>
          {oldText !== null && <DiffLines text={oldText.split('\n').map((l) => `-${l}`).join('\n')} />}
          {newText !== null && <DiffLines text={newText.split('\n').map((l) => `+${l}`).join('\n')} />}
        </pre>
      );
    } else if (output) {
      body = <pre className={PRE}>{output}</pre>;
    } else {
      body = <div className="p-2.5 text-xs italic text-text-tertiary">No diff details available.</div>;
    }
  } else if (output) {
    body = <pre className={PRE}>{output}</pre>;
  } else if (!tool.error) {
    body = (
      <div className="p-2.5 text-xs italic text-text-tertiary">
        {tool.status === 'running' ? 'Running…' : '(No output returned)'}
      </div>
    );
  }

  return (
    <div
      className="my-1 overflow-hidden rounded-md border border-border-subtle bg-bg-code"
      data-testid="tool-detail"
    >
      {tool.target && category !== 'command' && (
        <div className="truncate border-b border-border-subtle px-2.5 py-1 font-mono text-xs text-text-tertiary" title={tool.target}>
          {tool.target}
        </div>
      )}
      {body}
      {tool.error && (
        <div className="border-t border-border-subtle px-2.5 py-1.5 font-mono text-xs text-status-error-text">
          {tool.error}
        </div>
      )}
    </div>
  );
}
