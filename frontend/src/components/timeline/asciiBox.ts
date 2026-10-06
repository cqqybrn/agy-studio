const BOX_CHAR = /[┌┐└┘├┤┬┴┼─│╭╮╯╰╔╗╚╝╠╣╦╩╬═║┏┓┗┛┣┫┳┻╋━┃]/;

/** Opening/closing line of a fenced code block: up to 3 spaces, then ``` or ~~~ (3 or more). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Blockquote lines stay markdown so the quote is not split apart. */
const BLOCKQUOTE = /^ {0,3}>/;

export function isAsciiBoxLine(line: string): boolean {
  return BOX_CHAR.test(line) && !BLOCKQUOTE.test(line);
}

export type MarkdownSegment = { kind: 'md' | 'box'; text: string };

/**
 * Split markdown so consecutive box-drawing lines become their own copyable blocks.
 * A run of fewer than two box lines stays in the surrounding markdown. Lines inside fenced code
 * blocks are never split out: that would separate the opening and closing fences and turn the
 * rest of the message into one code block.
 */
export function splitMarkdownSegments(content: string): MarkdownSegment[] {
  if (!content) return [];
  const lines = content.split('\n');
  const segments: MarkdownSegment[] = [];
  let md: string[] = [];
  /** The fence that opened the current code block (e.g. "```"), or null outside one. */
  let openFence: string | null = null;

  const flushMd = () => {
    if (md.length === 0) return;
    const text = md.join('\n');
    md = [];
    if (text.length > 0) segments.push({ kind: 'md', text });
  };

  let i = 0;
  while (i < lines.length) {
    const fence = FENCE.exec(lines[i])?.[1];
    if (openFence !== null) {
      // A closing fence uses the same character and is at least as long as the opening one.
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
      md.push(lines[i]);
      i += 1;
      continue;
    }
    if (fence) {
      openFence = fence;
      md.push(lines[i]);
      i += 1;
      continue;
    }
    if (!isAsciiBoxLine(lines[i])) {
      md.push(lines[i]);
      i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && isAsciiBoxLine(lines[i]) && !FENCE.test(lines[i])) i += 1;
    if (i - start >= 2) {
      flushMd();
      segments.push({ kind: 'box', text: lines.slice(start, i).join('\n') });
    } else {
      md.push(...lines.slice(start, i));
    }
  }
  flushMd();
  return segments;
}
