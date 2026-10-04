import type {
  ConversationRewindPort,
  ConversationRewindRequest,
} from '../../services/ports/conversation-rewind.port.js';
import type { AgyProfile } from './profile/schema.js';
import { resolveRunnerBinary } from './process.js';
import { AppError } from '../../utils/errors.js';

/**
 * agy has no headless rewind. Its interactive `/rewind` command opens a picker of the
 * conversation's user messages; selecting one drops that message and every later turn from agy's
 * history (and reverts agy's file changes from those turns). This drives that picker in a
 * pseudo-terminal, rendering the screen with a headless xterm so the text can be read reliably.
 *
 * Observed with agy 1.2.16: a rewind done in a session that is not fully set up fails with
 * "failed to construct executor: plan model not specified", and that failure leaves the
 * conversation broken for good (later runs end with the same error). Two situations cause it:
 * acting as soon as the prompt appears, and acting in the session that just accepted the folder
 * trust prompt. So the driver waits for the screen to settle, restarts agy after accepting trust,
 * never retries inside a session, and verifies the result in a fresh session afterwards.
 */

/** A pseudo-terminal running agy, exposing the rendered screen. */
export interface TerminalSession {
  write(data: string): void;
  /** Visible screen rows, right-trimmed. */
  screen(): string[];
  readonly exited: boolean;
  kill(): void;
}

export type TerminalFactory = (
  bin: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
) => Promise<TerminalSession>;

const COLS = 200;
const ROWS = 60;

const KEY = { enter: '\r', up: '\x1b[A', esc: '\x1b', ctrlC: '\x03' };

const TRUST_PROMPT = 'Do you trust the contents of this project?';
const READY_HINT = '? for shortcuts';
const PICKER_TITLE = 'Rewind Conversation';
const PICKER_FOOTER = 'Keyboard:';
const CURRENT_ENTRY = '(current)';

/** Default factory: node-pty + @xterm/headless, loaded lazily so the backend starts without them. */
export const nodePtyTerminalFactory: TerminalFactory = async (bin, args, options) => {
  let ptyModule: typeof import('node-pty');
  let xtermModule: typeof import('@xterm/headless');
  try {
    ptyModule = await import('node-pty');
    xtermModule = await import('@xterm/headless');
  } catch (err) {
    throw new AppError('AGY_SPAWN_ERROR', '当前环境缺少伪终端组件（node-pty），无法编辑重问', {
      cause: err,
    });
  }
  const spawn = ptyModule.spawn ?? (ptyModule as unknown as { default: typeof ptyModule }).default.spawn;
  const Terminal =
    xtermModule.Terminal ?? (xtermModule as unknown as { default: typeof xtermModule }).default.Terminal;

  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  const child = spawn(bin, args, {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: options.cwd,
    env: options.env as Record<string, string>,
  });

  let exited = false;
  child.onData((data) => term.write(data));
  child.onExit(() => {
    exited = true;
  });

  return {
    write: (data) => {
      if (!exited) child.write(data);
    },
    screen: () => {
      const buffer = term.buffer.active;
      const rows: string[] = [];
      for (let i = buffer.baseY; i < buffer.baseY + ROWS; i++) {
        rows.push(buffer.getLine(i)?.translateToString(true) ?? '');
      }
      return rows;
    },
    get exited() {
      return exited;
    },
    kill: () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    },
  };
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Error lines agy prints in the transcript, e.g. "⚠ failed to construct executor: ...". */
export function warningLines(screen: string[]): string[] {
  return screen.map((line) => line.trim()).filter((line) => line.startsWith('⚠') || line.startsWith('Error ID:'));
}

/** Picker rows show the message truncated to one line, ending in "..." when cut. */
export function pickerEntryMatches(entryText: string, messageText: string): boolean {
  const entry = normalize(entryText).replace(/(\.\.\.|…)$/, '').trim();
  const message = normalize(messageText);
  if (!entry || !message) return false;
  return message.startsWith(entry) || entry.startsWith(message);
}

export interface PickerState {
  /** Raw picker block, used to detect whether a key press changed anything. */
  block: string;
  /** Text of the highlighted entry, or null when none is highlighted. */
  selected: string | null;
  /** Visible message entries in order (oldest first), without "(current)". */
  entries: string[];
}

/** Reads the open /rewind picker from the screen, or returns null when it is not shown. */
export function readPicker(screen: string[]): PickerState | null {
  const start = screen.findIndex((line) => line.trim() === PICKER_TITLE);
  if (start < 0) return null;
  const end = screen.findIndex((line, i) => i > start && line.trimStart().startsWith(PICKER_FOOTER));
  if (end < 0) return null;
  const lines = screen.slice(start + 1, end);
  // Entries start with "> " (highlighted) or two spaces; detail rows ("(5m ago) · 1 file changed")
  // are indented further.
  const entryLines = lines.filter((line) => /^(> | {2})\S/.test(line));
  const selectedLine = entryLines.find((line) => line.startsWith('> '));
  return {
    block: lines.join('\n'),
    selected: selectedLine ? selectedLine.slice(2).trimEnd() : null,
    entries: entryLines.map((line) => line.slice(2).trimEnd()).filter((text) => text !== CURRENT_ENTRY),
  };
}

export interface RewindTerminalOptions {
  profile: AgyProfile;
  defaultBin?: string;
  terminalFactory?: TerminalFactory;
  /** Overall limit for one rewind, including the verification session. */
  timeoutMs?: number;
  /** Screen polling interval. */
  pollMs?: number;
  /** How long the screen must stay unchanged after selecting, before quitting agy. */
  settleMs?: number;
  /** How long the screen must stay unchanged after the prompt appears before using it. */
  readySettleMs?: number;
}

export class RewindTerminal implements ConversationRewindPort {
  private readonly profile: AgyProfile;
  private readonly defaultBin?: string;
  private readonly factory: TerminalFactory;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly settleMs: number;
  private readonly readySettleMs: number;

  constructor(options: RewindTerminalOptions) {
    this.profile = options.profile;
    this.defaultBin = options.defaultBin;
    this.factory = options.terminalFactory ?? nodePtyTerminalFactory;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.pollMs = options.pollMs ?? 150;
    this.settleMs = options.settleMs ?? 2_000;
    this.readySettleMs = options.readySettleMs ?? 3_000;
  }

  async rewindToMessage(request: ConversationRewindRequest): Promise<void> {
    if (request.occurrenceFromEnd < 1) {
      throw new AppError('BAD_REQUEST', 'occurrenceFromEnd must be at least 1');
    }
    const deadline = Date.now() + this.timeoutMs;

    let latestBefore: string | null = null;
    await this.withSession(request, deadline, async (term) => {
      const result = await this.selectAndRewind(term, request, deadline);
      latestBefore = result.latestBefore;
      const failure = result.failure;
      if (failure) {
        throw new AppError('AGY_EXIT', `agy 回退失败：${failure}`, {
          details: { screen: this.screenTail(term) },
        });
      }
    });

    // The rewind is applied asynchronously after the picker closes; check it really happened.
    // Normally the latest message is now the one before the edited message. Studio may also hold
    // messages agy never received (a run that failed to start), so a changed latest message
    // counts as success too; an unchanged one means nothing was dropped.
    if (request.previousMessageText !== null) {
      const previous = request.previousMessageText;
      const before = latestBefore as string | null;
      await this.withSession(request, deadline, async (term) => {
        const picker = await this.openPicker(term, deadline);
        term.write(KEY.esc);
        const latest = picker.entries[picker.entries.length - 1] ?? null;
        const rewound =
          latest !== null &&
          (pickerEntryMatches(latest, previous) || (before !== null && normalize(latest) !== normalize(before)));
        if (!rewound) {
          throw new AppError('AGY_EXIT', 'agy 没有完成回退（对话历史未变化），请重试', {
            retryable: true,
            details: { latestEntry: latest, screen: this.screenTail(term) },
          });
        }
      });
    }
  }

  /**
   * Runs `fn` in an interactive agy session on the conversation. When agy first asks to trust the
   * folder, the trust is accepted and agy restarted, because that first session is not usable.
   */
  private async withSession(
    request: ConversationRewindRequest,
    deadline: number,
    fn: (term: TerminalSession) => Promise<void>,
  ): Promise<void> {
    const bin = resolveRunnerBinary(this.profile, this.defaultBin);
    const spawn = () =>
      this.factory(bin, ['--conversation', request.conversationId], {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
      });

    let term = await spawn();
    try {
      if (await this.waitUntilReady(term, deadline)) {
        await this.exit(term);
        term = await spawn();
        if (await this.waitUntilReady(term, deadline)) {
          throw new AppError('AGY_EXIT', 'agy 没有记住对该工作区的信任，无法回退', {
            details: { screen: this.screenTail(term) },
          });
        }
      }
      await fn(term);
    } finally {
      await this.exit(term);
    }
  }

  /**
   * Waits until agy shows its prompt and has finished loading. Returns true when it asked to trust
   * the folder (the trust was accepted and the caller must restart agy).
   */
  private async waitUntilReady(term: TerminalSession, deadline: number): Promise<boolean> {
    let trusted = false;
    await this.waitFor(
      term,
      deadline,
      () => {
        const text = term.screen().join('\n');
        if (!trusted && text.includes(TRUST_PROMPT)) {
          // Default choice is "Yes, I trust this folder"; Studio already runs agy here.
          trusted = true;
          term.write(KEY.enter);
          return null;
        }
        return text.includes(READY_HINT) ? true : null;
      },
      'agy 交互界面没有就绪',
    );
    // The prompt shows before agy has loaded the account and model.
    await this.waitForStableScreen(term, deadline, this.readySettleMs);
    return trusted;
  }

  private async openPicker(term: TerminalSession, deadline: number): Promise<PickerState> {
    for (const ch of '/rewind') term.write(ch);
    await this.sleep(300);
    term.write(KEY.enter);
    return this.waitFor(term, deadline, () => readPicker(term.screen()), '回退列表没有出现');
  }

  /**
   * Selects the message in the picker and confirms. Returns agy's error text when it fails, and
   * the latest message in agy's history before the rewind.
   */
  private async selectAndRewind(
    term: TerminalSession,
    request: ConversationRewindRequest,
    deadline: number,
  ): Promise<{ failure: string | null; latestBefore: string | null }> {
    let picker = await this.openPicker(term, deadline);
    const latestBefore = picker.entries[picker.entries.length - 1] ?? null;

    let remaining = request.occurrenceFromEnd;
    for (;;) {
      term.write(KEY.up);
      const previous = picker.block;
      const next = await this.waitFor(
        term,
        Math.min(deadline, Date.now() + 2_000),
        () => {
          const state = readPicker(term.screen());
          return state && state.block !== previous ? state : null;
        },
        '',
      ).catch(() => null);

      if (!next) {
        // Nothing moved: already at the oldest message.
        term.write(KEY.esc);
        throw new AppError(
          'CONFLICT',
          '在 agy 的对话历史里找不到这条消息（可能那次运行没有成功送达 agy），无法回退',
        );
      }
      picker = next;
      if (picker.selected && pickerEntryMatches(picker.selected, request.messageText)) {
        remaining -= 1;
        if (remaining === 0) break;
      }
    }

    const warningsBefore = new Set(warningLines(term.screen()));
    term.write(KEY.enter);
    // agy closes the picker and puts the rewound message back into the input box, then applies the
    // rewind; quitting right away would abort it.
    await this.waitFor(
      term,
      deadline,
      () => {
        const screen = term.screen();
        if (readPicker(screen) !== null) return null;
        const prefilled = screen.some(
          (line) => line.startsWith('> ') && pickerEntryMatches(line.slice(2), request.messageText),
        );
        return prefilled ? true : null;
      },
      '回退没有完成',
    );
    await this.waitForStableScreen(term, deadline, this.settleMs);

    const failure = warningLines(term.screen()).find((line) => !warningsBefore.has(line));
    return { failure: failure ? failure.replace(/^⚠\s*/, '') : null, latestBefore };
  }

  private async waitForStableScreen(term: TerminalSession, deadline: number, quietMs: number): Promise<void> {
    let last = term.screen().join('\n');
    let stableSince = Date.now();
    while (Date.now() - stableSince < quietMs) {
      if (term.exited || Date.now() >= deadline) return;
      await this.sleep(this.pollMs);
      const now = term.screen().join('\n');
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      }
    }
  }

  private async waitFor<T>(
    term: TerminalSession,
    deadline: number,
    probe: () => T | null,
    timeoutMessage: string,
  ): Promise<T> {
    for (;;) {
      const value = probe();
      if (value !== null) return value;
      if (term.exited) {
        throw new AppError('AGY_EXIT', `agy 意外退出：${timeoutMessage}`, {
          details: { screen: this.screenTail(term) },
        });
      }
      if (Date.now() >= deadline) {
        throw new AppError('AGY_TIMEOUT', `回退超时：${timeoutMessage}`, {
          retryable: true,
          details: { screen: this.screenTail(term) },
        });
      }
      await this.sleep(this.pollMs);
    }
  }

  /**
   * The first Ctrl+C clears the input agy prefilled with the rewound message, the second arms
   * "press ctrl+c again to exit", the third quits.
   */
  private async exit(term: TerminalSession): Promise<void> {
    for (let i = 0; i < 3 && !term.exited; i++) {
      term.write(KEY.ctrlC);
      await this.sleep(400);
    }
    const until = Date.now() + 5_000;
    while (!term.exited && Date.now() < until) await this.sleep(this.pollMs);
    if (!term.exited) term.kill();
  }

  private screenTail(term: TerminalSession): string {
    return term
      .screen()
      .filter((line) => line.trim())
      .slice(-12)
      .join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
