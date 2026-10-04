import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  pickerEntryMatches,
  readPicker,
  RewindTerminal,
  warningLines,
  type TerminalFactory,
  type TerminalSession,
} from '../../src/integrations/agy/rewind-terminal.js';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profile = loadProfile(path.resolve(__dirname, '../../agy-profile.json'));

const SHOWN_WIDTH = 60;
const shown = (text: string) => (text.length > SHOWN_WIDTH ? `${text.slice(0, SHOWN_WIDTH - 3)}...` : text);

/** agy's stored state for one conversation and workspace, shared by every session it starts. */
class FakeConversation {
  entries: string[];
  trusted: boolean;
  /** Number of rewinds that print agy's executor error instead of applying. */
  failNextRewinds = 0;
  /** Rewinds look applied on screen but are never saved. */
  dropRewinds = false;
  rewoundTo: number | null = null;
  sessions: FakeAgy[] = [];

  constructor(entries: string[], options: { trusted?: boolean } = {}) {
    this.entries = [...entries];
    this.trusted = options.trusted ?? true;
  }
}

/** Minimal model of agy's interactive UI around /rewind (picker layout taken from agy 1.2.16). */
class FakeAgy implements TerminalSession {
  phase: 'trust' | 'ready' | 'picker';
  entries: string[];
  selected = 0;
  input = '';
  warnings: string[] = [];
  escPressed = false;
  exited = false;
  /** agy 1.2.16 cannot rewind in the session that accepted the trust prompt. */
  private justTrusted = false;
  private exitArmed = false;
  private errorCount = 0;

  constructor(private readonly conv: FakeConversation) {
    this.entries = [...conv.entries];
    this.phase = conv.trusted ? 'ready' : 'trust';
  }

  screen(): string[] {
    if (this.phase === 'trust') {
      return ['Accessing workspace:', '', 'Do you trust the contents of this project?', '', '> Yes, I trust this folder', '  No, exit'];
    }
    const transcript = this.entries.flatMap((e) => ['────', `> ${e}`, '', '  OK']);
    const inputBox = ['────', `> ${this.input}`, '────'];
    if (this.phase === 'picker') {
      const rows = this.entries.flatMap((e, i) => [`${i === this.selected ? '>' : ' '} ${shown(e)}`, '    (just now)']);
      rows.push(`${this.selected === this.entries.length ? '>' : ' '} (current)`);
      return [...transcript, ...this.warnings, ...inputBox, 'Rewind Conversation', '', ...rows, '', 'Keyboard: ↑/↓ Navigate  enter Select  esc Cancel'];
    }
    return [...transcript, ...this.warnings, ...inputBox, this.exitArmed ? 'press ctrl+c again to exit' : '? for shortcuts'];
  }

  write(data: string): void {
    if (this.exited) return;
    if (this.phase === 'trust') {
      if (data === '\r') {
        this.conv.trusted = true;
        this.justTrusted = true;
        this.phase = 'ready';
      }
      return;
    }
    if (this.phase === 'picker') {
      if (data === '\x1b[A') this.selected = Math.max(0, this.selected - 1);
      else if (data === '\x1b') {
        this.escPressed = true;
        this.phase = 'ready';
      } else if (data === '\r') {
        this.phase = 'ready';
        if (this.selected === this.entries.length) return;
        this.input = this.entries[this.selected];
        if (this.justTrusted || this.conv.failNextRewinds > 0) {
          if (!this.justTrusted) this.conv.failNextRewinds -= 1;
          this.errorCount += 1;
          this.warnings.push('⚠ failed to construct executor: plan model not specified', `Error ID: e-${this.errorCount}`);
          return;
        }
        this.entries = this.entries.slice(0, this.selected);
        if (!this.conv.dropRewinds) {
          this.conv.rewoundTo = this.selected;
          this.conv.entries = [...this.entries];
        }
      }
      return;
    }
    if (data === '\x03') {
      if (this.input) this.input = '';
      else if (this.exitArmed) this.exited = true;
      else this.exitArmed = true;
      return;
    }
    if (data === '\r') {
      if (this.input === '/rewind') {
        this.phase = 'picker';
        this.selected = this.entries.length;
        this.input = '';
      }
      return;
    }
    this.exitArmed = false;
    this.input += data;
  }

  kill(): void {
    this.exited = true;
  }
}

function driver(conv: FakeConversation) {
  const spawns: string[][] = [];
  const factory: TerminalFactory = async (_bin, args) => {
    spawns.push(args);
    const agy = new FakeAgy(conv);
    conv.sessions.push(agy);
    return agy;
  };
  const rewinder = new RewindTerminal({
    profile,
    terminalFactory: factory,
    pollMs: 1,
    settleMs: 20,
    readySettleMs: 20,
    timeoutMs: 5_000,
  });
  return { rewinder, spawns };
}

const request = (messageText: string, previousMessageText: string | null, occurrenceFromEnd = 1) => ({
  conversationId: 'conv-1',
  cwd: 'C:/work',
  messageText,
  occurrenceFromEnd,
  previousMessageText,
});

describe('RewindTerminal', () => {
  it('rewinds the conversation, verifies it in a new session and quits agy', async () => {
    const conv = new FakeConversation(['number 41', 'word banana', 'color purple']);
    const { rewinder, spawns } = driver(conv);

    await rewinder.rewindToMessage(request('word banana', 'number 41'));

    expect(spawns).toEqual([
      ['--conversation', 'conv-1'],
      ['--conversation', 'conv-1'],
    ]);
    expect(conv.rewoundTo).toBe(1);
    expect(conv.entries).toEqual(['number 41']);
    expect(conv.sessions.every((s) => s.exited)).toBe(true);
    // The verification session only looks at the picker.
    expect(conv.sessions[1].escPressed).toBe(true);
  });

  it('skips verification when the first message is edited', async () => {
    const conv = new FakeConversation(['a', 'b']);
    const { rewinder, spawns } = driver(conv);
    await rewinder.rewindToMessage(request('a', null));
    expect(conv.entries).toEqual([]);
    expect(spawns).toHaveLength(1);
  });

  it('restarts agy after accepting the folder trust prompt', async () => {
    const conv = new FakeConversation(['a', 'b'], { trusted: false });
    const { rewinder, spawns } = driver(conv);
    await rewinder.rewindToMessage(request('b', 'a'));
    expect(conv.trusted).toBe(true);
    expect(conv.rewoundTo).toBe(1);
    // trust session, rewind session, verification session
    expect(spawns).toHaveLength(3);
    expect(conv.sessions[0].exited).toBe(true);
    expect(conv.sessions[0].entries).toEqual(['a', 'b']);
  });

  it('picks the requested occurrence when messages repeat', async () => {
    const conv = new FakeConversation(['same', 'other', 'same', 'last']);
    await driver(conv).rewinder.rewindToMessage(request('same', null, 2));
    expect(conv.rewoundTo).toBe(0);
    expect(conv.entries).toEqual([]);
  });

  it('matches messages that agy truncates in the picker', async () => {
    const long = 'Please refactor the authentication module so that sessions expire after thirty minutes';
    const conv = new FakeConversation(['first', long, 'after']);
    await driver(conv).rewinder.rewindToMessage(request(long, 'first'));
    expect(conv.rewoundTo).toBe(1);
  });

  it('cancels and reports CONFLICT when the message is not in agy history', async () => {
    const conv = new FakeConversation(['a', 'b']);
    await expect(driver(conv).rewinder.rewindToMessage(request('never sent', 'b'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(conv.sessions[0].escPressed).toBe(true);
    expect(conv.rewoundTo).toBeNull();
    expect(conv.entries).toEqual(['a', 'b']);
    expect(conv.sessions[0].exited).toBe(true);
  });

  it("fails with agy's message without retrying when agy reports an error", async () => {
    const conv = new FakeConversation(['a', 'b']);
    conv.failNextRewinds = 1;
    const { rewinder, spawns } = driver(conv);
    const err = await rewinder.rewindToMessage(request('b', 'a')).catch((e) => e);
    expect(err).toMatchObject({ code: 'AGY_EXIT' });
    expect(err.message).toContain('plan model not specified');
    expect(conv.rewoundTo).toBeNull();
    expect(spawns).toHaveLength(1);
    expect(conv.sessions[0].exited).toBe(true);
  });

  it('fails when the rewind was not saved', async () => {
    const conv = new FakeConversation(['a', 'b', 'c']);
    conv.dropRewinds = true;
    const err = await driver(conv).rewinder.rewindToMessage(request('b', 'a')).catch((e) => e);
    expect(err).toMatchObject({ code: 'AGY_EXIT' });
    expect(err.message).toContain('没有完成回退');
  });

  it('accepts a changed history when Studio holds a message agy never received', async () => {
    // Studio has a, lost, b, c where "lost" never reached agy; editing b leaves agy at "a".
    const conv = new FakeConversation(['a', 'b', 'c']);
    await driver(conv).rewinder.rewindToMessage(request('b', 'lost'));
    expect(conv.entries).toEqual(['a']);
  });

  it('fails when agy exits unexpectedly', async () => {
    const conv = new FakeConversation(['a']);
    const factory: TerminalFactory = async () => {
      const agy = new FakeAgy(conv);
      agy.exited = true;
      return agy;
    };
    const rewinder = new RewindTerminal({ profile, terminalFactory: factory, pollMs: 1, readySettleMs: 20, timeoutMs: 5_000 });
    await expect(rewinder.rewindToMessage(request('a', null))).rejects.toMatchObject({ code: 'AGY_EXIT' });
  });
});

describe('rewind picker parsing', () => {
  it('reads the entries and the highlighted one only inside the picker', () => {
    const screen = [
      '> earlier message in the transcript',
      '────',
      '> ',
      '────',
      'Rewind Conversation',
      '',
      '  first message',
      '    (5m ago)',
      '> second message',
      '    (5m ago) · 1 file changed +2 -0',
      '  (current)',
      '',
      'Keyboard: ↑/↓ Navigate  enter Select  esc Cancel',
    ];
    expect(readPicker(screen)?.selected).toBe('second message');
    expect(readPicker(screen)?.entries).toEqual(['first message', 'second message']);
    expect(readPicker(screen.slice(0, 4))).toBeNull();
  });

  it('compares truncated and whitespace-different texts', () => {
    expect(pickerEntryMatches('Create a file named notes.txt in the current directory containing the single ...', 'Create a file named notes.txt in the current directory containing the single line: banana.')).toBe(true);
    expect(pickerEntryMatches('hello   world', 'hello world')).toBe(true);
    expect(pickerEntryMatches('hello', 'goodbye')).toBe(false);
    expect(pickerEntryMatches('', 'x')).toBe(false);
  });

  it('finds agy warning lines', () => {
    expect(warningLines(['  OK', '⚠ failed to construct executor', 'Error ID: abc'])).toEqual([
      '⚠ failed to construct executor',
      'Error ID: abc',
    ]);
  });
});
