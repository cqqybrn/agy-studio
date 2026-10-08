/** Opening/closing line of a fenced code block: up to 3 spaces, then ``` or ~~~ (3 or more). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A line holding nothing but `$$ … $$`. */
const ONE_LINE_DISPLAY_MATH = /^(\s*)\$\$(?!\$)(.+?)\$\$\s*$/;

/**
 * Models often write a display formula on a single line (`$$x^2$$`). remark-math only treats
 * `$$` as a block when the fences are on their own lines, so such a line would render as small
 * inline math. Rewrite it to the block form. Lines inside fenced code blocks are left alone.
 */
export function normalizeDisplayMath(markdown: string): string {
  if (!markdown.includes('$$')) return markdown;
  let openFence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const fence = FENCE.exec(line)?.[1];
      if (openFence !== null) {
        if (fence && fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
        return line;
      }
      if (fence) {
        openFence = fence;
        return line;
      }
      const m = ONE_LINE_DISPLAY_MATH.exec(line);
      if (!m || !m[2].trim()) return line;
      return `${m[1]}$$\n${m[1]}${m[2].trim()}\n${m[1]}$$`;
    })
    .join('\n');
}
