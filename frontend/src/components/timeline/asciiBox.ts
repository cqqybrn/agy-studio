const BOX_CHAR = /[┌┐└┘├┤┬┴┼─│╭╮╯╰╔╗╚╝╠╣╦╩╬═║┏┓┗┛┣┫┳┻╋━┃]/;

export function isAsciiBoxLine(line: string): boolean {
  return BOX_CHAR.test(line);
}

export type MarkdownSegment = { kind: 'md' | 'box'; text: string };

/**
 * Split markdown so consecutive box-drawing lines become their own copyable blocks.
 * A run of fewer than two box lines stays in the surrounding markdown.
 */
export function splitMarkdownSegments(content: string): MarkdownSegment[] {
  if (!content) return [];
  const lines = content.split('\n');
  const segments: MarkdownSegment[] = [];
  let md: string[] = [];

  const flushMd = () => {
    if (md.length === 0) return;
    const text = md.join('\n');
    md = [];
    if (text.length > 0) segments.push({ kind: 'md', text });
  };

  let i = 0;
  while (i < lines.length) {
    if (!isAsciiBoxLine(lines[i])) {
      md.push(lines[i]);
      i += 1;
      continue;
    }
    const start = i;
    while (i < lines.length && isAsciiBoxLine(lines[i])) i += 1;
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
