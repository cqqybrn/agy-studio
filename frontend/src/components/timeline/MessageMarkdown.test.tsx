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

describe('MessageMarkdown math', () => {
  it('renders $$…$$ formulas, including CJK text inside \text{}', () => {
    const html = render(String.raw`句式：

$$\text{【主语（주어）】} + \text{【名词短语（설명어）】} + \text{也（종결사）}$$`);
    expect(html).toContain('katex-display');
    expect(html).toContain('【主语（주어）】');
    const visible = html.replace(/<annotation[\s\S]*?<\/annotation>/g, '').replace(/<[^>]+>/g, '');
    expect(visible).not.toContain('$$');
    expect(visible).not.toContain('\text');
  });

  it('renders inline $…$ and shows broken formulas instead of failing', () => {
    expect(render(String.raw`面积 $S = \pi r^2$ 公式`)).toMatch(/class="katex"/);
    const broken = render(String.raw`坏公式 $\frac{1$ 结束`);
    expect(broken).toContain('结束');
  });
});

describe('MessageMarkdown CJK emphasis', () => {
  it('closes **bold** that ends in CJK punctuation right before CJK text', () => {
    const html = render('习惯了**“谓语”**这个词，**“是”**老子的主旨。');
    expect(html).not.toContain('**');
    expect(html.match(/<strong/g)).toHaveLength(2);
    expect(html).toMatch(/<strong[^>]*>“是”<\/strong>老子/);
  });
});
