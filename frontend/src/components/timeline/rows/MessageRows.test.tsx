import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UserMessageItem } from '../../../domain/timeline.types';
import { UserMessageRow } from './MessageRows';

const item: UserMessageItem = {
  id: 'user-msg-m1',
  kind: 'user_message',
  type: 'user_message',
  messageId: 'm1',
  text: 'Refactor the login flow',
  attachments: [],
  runId: null,
  createdAt: '2026-10-04T00:00:00.000Z',
};

const isDisabled = (button: string | null) => /\sdisabled=""/.test(button ?? '');
const editButton = (html: string) => html.match(/<button[^>]*data-testid="user-message-edit-btn"[^>]*>/)?.[0] ?? null;

describe('UserMessageRow editing', () => {
  it('shows no edit button when editing is not available', () => {
    const html = renderToString(<UserMessageRow item={item} />);
    expect(html).toContain('Refactor the login flow');
    expect(editButton(html)).toBeNull();
  });

  it('offers an edit button when an edit handler is given', () => {
    const html = renderToString(<UserMessageRow item={item} onEdit={async () => {}} />);
    const button = editButton(html);
    expect(button).not.toBeNull();
    expect(isDisabled(button)).toBe(false);
    expect(button).toContain('title="编辑并重新提问"');
  });

  it('disables the edit button with the reason while a run is active', () => {
    const html = renderToString(
      <UserMessageRow item={item} onEdit={async () => {}} editDisabledReason="运行中无法编辑，请等运行结束" />,
    );
    const button = editButton(html);
    expect(isDisabled(button)).toBe(true);
    expect(button).toContain('title="运行中无法编辑，请等运行结束"');
  });
});
