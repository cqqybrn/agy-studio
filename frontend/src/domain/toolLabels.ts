import type { ToolCall, ToolKind } from '@agy-studio/contracts';

/**
 * Display category of a tool call. Adjacent tools of the same category are counted
 * together in the timeline ("Ran 2 commands"), so this is coarser than ToolKind.
 */
export type ToolCategory =
  | 'command'
  | 'edit'
  | 'view'
  | 'explore'
  | 'browser'
  | 'mcp'
  | 'subagent'
  | 'other';

export function toolCategory(kind: ToolKind): ToolCategory {
  switch (kind) {
    case 'run_command':
      return 'command';
    case 'edit_file':
    case 'write_file':
      return 'edit';
    case 'view_file':
      return 'view';
    case 'search':
      return 'explore';
    case 'browser':
      return 'browser';
    case 'mcp':
      return 'mcp';
    case 'subagent':
      return 'subagent';
    default:
      return 'other';
  }
}

const VERBS: Record<ToolCategory, { running: string; done: string }> = {
  command: { running: 'Running', done: 'Ran' },
  edit: { running: 'Editing', done: 'Edited' },
  view: { running: 'Reading', done: 'Viewed' },
  explore: { running: 'Exploring', done: 'Explored' },
  browser: { running: 'Browsing', done: 'Browsed' },
  mcp: { running: 'Calling', done: 'Called' },
  subagent: { running: 'Delegating', done: 'Delegated' },
  other: { running: 'Using', done: 'Used' },
};

export function toolVerb(category: ToolCategory, running: boolean): string {
  return running ? VERBS[category].running : VERBS[category].done;
}

const GROUP_NOUNS: Record<ToolCategory, [string, string]> = {
  command: ['command', 'commands'],
  edit: ['file', 'files'],
  view: ['file', 'files'],
  explore: ['item', 'items'],
  browser: ['page', 'pages'],
  mcp: ['tool', 'tools'],
  subagent: ['task', 'tasks'],
  other: ['tool', 'tools'],
};

/** "Ran 2 commands" / "Running 2 commands" for a run of adjacent same-category tools. */
export function toolGroupLabel(category: ToolCategory, count: number, running: boolean): string {
  const [singular, plural] = GROUP_NOUNS[category];
  return `${toolVerb(category, running)} ${count} ${count === 1 ? singular : plural}`;
}

export function fileBaseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** `fix_name.py` → "Fix Name"; names without word separators keep their spelling. */
export function prettyFileName(path: string): string {
  const base = fileBaseName(path);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  if (!/[_-]/.test(stem)) {
    return stem || base;
  }
  const words = stem.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) {
    return base;
  }
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function fileExtension(path: string): string {
  const base = fileBaseName(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export interface LineDelta {
  additions: number;
  deletions: number;
}

/** Summed +/- line counts, or null when the backend did not report them. */
export function toolLineDelta(tool: ToolCall): LineDelta | null {
  let additions = 0;
  let deletions = 0;
  let known = false;
  for (const change of tool.fileChanges) {
    if (change.additions !== null) {
      additions += change.additions;
      known = true;
    }
    if (change.deletions !== null) {
      deletions += change.deletions;
      known = true;
    }
  }
  return known ? { additions, deletions } : null;
}

/** The file path an edit/view tool acts on. */
export function toolFilePath(tool: ToolCall): string | null {
  return tool.fileChanges[0]?.path ?? tool.target;
}
