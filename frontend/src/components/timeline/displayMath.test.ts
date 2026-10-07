import { describe, expect, it } from 'vitest';
import { normalizeDisplayMath } from './displayMath';

describe('normalizeDisplayMath', () => {
  it('moves a one-line $$…$$ formula onto its own block lines', () => {
    expect(normalizeDisplayMath('前\n$$x^2 + y^2$$\n后')).toBe('前\n$$\nx^2 + y^2\n$$\n后');
  });

  it('leaves inline, block-form and code-fenced math alone', () => {
    const inline = '句子里 $$x$$ 中间';
    expect(normalizeDisplayMath(inline)).toBe(inline);
    const block = '$$\nx\n$$';
    expect(normalizeDisplayMath(block)).toBe(block);
    const fenced = '```\n$$x$$\n```';
    expect(normalizeDisplayMath(fenced)).toBe(fenced);
  });
});
