import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@agy-studio/contracts';
import { ToolDetail } from './ToolDetail';

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    toolCallId: 't1',
    name: 'run_command',
    kind: 'run_command',
    input: {},
    target: null,
    output: null,
    error: null,
    fileChanges: [],
    status: 'succeeded',
    startedAt: '2026-10-06T00:00:00.000Z',
    endedAt: '2026-10-06T00:00:01.000Z',
    ...overrides,
  };
}

describe('ToolDetail', () => {
  it('renders web search results as markdown', () => {
    const html = renderToStaticMarkup(
      <ToolDetail
        tool={tool({ name: 'search_web', kind: 'search', target: 'JPY to USD', output: 'Rate is **0.0063 USD**[1].' })}
      />,
    );
    expect(html).toContain('data-testid="tool-detail-markdown"');
    expect(html).toContain('<strong');
    expect(html).toContain('0.0063 USD');
  });

  it('keeps other tool output as plain text', () => {
    const html = renderToStaticMarkup(<ToolDetail tool={tool({ name: 'view_file', kind: 'view_file', output: '**x**' })} />);
    expect(html).not.toContain('tool-detail-markdown');
    expect(html).toContain('**x**');
  });
});
