import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageMarkdown } from './MessageMarkdown';

const render = (content: string) => renderToStaticMarkup(<MessageMarkdown content={content} />);

describe('MessageMarkdown <br> handling', () => {
  it('turns <br> into line breaks in paragraphs', () => {
    const html = render('第一行<br>第二行<br/><br />第三行');
    expect(html).not.toContain('&lt;br');
    expect(html.match(/<br\/>/g)).toHaveLength(3);
  });

  it('turns <br> into line breaks inside table cells', () => {
    const html = render('| 项 | 说明 |\n|---|---|\n| a | x<br>y |');
    expect(html).toMatch(/<td[^>]*>x<br\/>\s*y<\/td>/);
  });

  it('keeps other HTML escaped and leaves <br> inside code alone', () => {
    const html = render('x <b>bold</b> <script>1</script> `<br>`');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/<code[^>]*>&lt;br&gt;<\/code>/);
  });

  it('does not leak the markdown node into DOM attributes', () => {
    const html = render('# t\n\n- a\n\n| h |\n|---|\n| c |\n\n---\n\n[l](https://a.b) `c`');
    expect(html).not.toContain('node="');
  });
});
