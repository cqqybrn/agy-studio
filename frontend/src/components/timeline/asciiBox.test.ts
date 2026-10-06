import { describe, expect, it } from 'vitest';
import { splitMarkdownSegments } from './asciiBox';

describe('splitMarkdownSegments', () => {
  it('splits a bare box-drawing block out of the markdown', () => {
    const segments = splitMarkdownSegments('Before\n├── a\n│   └── b\nAfter **bold**');
    expect(segments).toEqual([
      { kind: 'md', text: 'Before' },
      { kind: 'box', text: '├── a\n│   └── b' },
      { kind: 'md', text: 'After **bold**' },
    ]);
  });

  it('leaves a tree inside a fenced code block alone so the fences stay paired', () => {
    const text = '### 方案\n```\n├── 📁 01 工作\n│   └── 📁 报告书\n```\n**共 22 项**\n\n### 方案二';
    expect(splitMarkdownSegments(text)).toEqual([{ kind: 'md', text }]);
  });

  it('handles ~~~ fences and longer closing fences', () => {
    const text = '~~~~\n├── a\n│ b\n~~~~~\n├── c\n└── d';
    expect(splitMarkdownSegments(text)).toEqual([
      { kind: 'md', text: '~~~~\n├── a\n│ b\n~~~~~' },
      { kind: 'box', text: '├── c\n└── d' },
    ]);
  });

  it('keeps blockquote lines with box characters in the markdown', () => {
    const text = '> **说明**：结构如下\n> ├── a\n> └── b';
    expect(splitMarkdownSegments(text)).toEqual([{ kind: 'md', text }]);
  });
});
