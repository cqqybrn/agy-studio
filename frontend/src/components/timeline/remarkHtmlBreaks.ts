/**
 * Models often write `<br>` for line breaks, especially inside table cells where a real newline
 * would end the row. Raw HTML is not rendered (it is shown escaped), so turn inline HTML that
 * consists only of `<br>` tags into markdown hard breaks. Any other HTML stays escaped.
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

const BR_ONLY = /^(?:\s*<br\s*\/?>\s*)+$/i;
const BR_TAG = /<br\s*\/?>/gi;

function replaceBreaks(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'html' && child.value !== undefined && BR_ONLY.test(child.value)) {
      const count = child.value.match(BR_TAG)?.length ?? 1;
      for (let i = 0; i < count; i++) next.push({ type: 'break' });
      continue;
    }
    replaceBreaks(child);
    next.push(child);
  }
  node.children = next;
}

export function remarkHtmlBreaks() {
  return (tree: MdNode) => replaceBreaks(tree);
}
