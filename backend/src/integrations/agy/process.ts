import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';
import type {
  AgentEvent,
  AgentMode,
  Effort,
  TokenUsage,
} from '@agy-studio/contracts';
import type { AgyProfile } from './profile/schema.js';
import { adapt, type AdaptResult } from './stream-adapter.js';
import { findAgyBinary } from './catalog.js';
import type {
  AgyRunnerPort,
  RunnerProcess,
  SpawnRunnerOptions,
} from '../../services/ports/agy-runner.port.js';
import { killTree, isProcessAlive } from '../../utils/proc-tree.js';
import { AppError } from '../../utils/errors.js';
import { createId } from '../../utils/ids.js';

export interface ProcessRunnerOptions extends SpawnRunnerOptions {
  model?: string | null;
  effort?: Effort | string | null;
  mode?: AgentMode | string | null;
  /** Custom agent name for `--agent`; null/empty/'default' keeps agy's built-in agent. */
  agent?: string | null;
  resumeConversationId?: string | null;
}

export interface ProcessRunnerProcess extends RunnerProcess {
  readonly child: ChildProcess;
  readonly conversationId: string | null;
  readonly terminal: AdaptResult['terminal'] | null;
  readonly usage: TokenUsage | null;
}

/**
 * Async queue implementing AsyncIterable for streaming AgentEvents.
 */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: Array<{
    resolve: (res: IteratorResult<T>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private isClosed = false;
  private errorState: unknown = null;

  push(item: T): void {
    if (this.isClosed) return;
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.resolve({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      if (this.queue.length > 0) {
        resolver.resolve({ value: this.queue.shift()!, done: false });
      } else {
        resolver.resolve({ value: undefined, done: true });
      }
    }
  }

  error(err: unknown): void {
    if (this.isClosed) return;
    this.errorState = err;
    this.isClosed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver.reject(err);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.errorState) {
          return Promise.reject(this.errorState);
        }
        if (this.isClosed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.resolvers.push({ resolve, reject });
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/**
 * Builds CLI argument list incorporating stream arguments, permissions, model, effort, mode, agent, and resume id.
 */
export function buildArgv(profile: AgyProfile, options: ProcessRunnerOptions): string[] {
  const scriptArg = options.argv?.find((a) => /\.(?:[cm]?[jt]s)$/.test(a));
  const otherArgs = options.argv?.filter((a) => a !== scriptArg) ?? [];

  const argv: string[] = [];
  if (scriptArg) {
    argv.push(scriptArg);
  }

  argv.push(
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
  );

  if (options.model) {
    argv.push('--model', options.model);
  }
  if (options.effort) {
    argv.push('--effort', String(options.effort));
  }
  if (options.mode) {
    argv.push('--mode', String(options.mode));
  }
  if (options.agent && options.agent.trim() && options.agent.trim().toLowerCase() !== 'default') {
    argv.push('--agent', options.agent.trim());
  }
  if (options.resumeConversationId) {
    argv.push('--conversation', options.resumeConversationId);
  }

  if (otherArgs.length > 0) {
    for (let i = 0; i < otherArgs.length; i++) {
      const arg = otherArgs[i];
      if (
        arg === '--input-format' ||
        arg === '--output-format' ||
        arg === '--dangerously-skip-permissions'
      ) {
        if (arg !== '--dangerously-skip-permissions') {
          i++; // skip parameter value
        }
        continue;
      }
      argv.push(arg);
    }
  }

  return argv;
}

/**
 * Resolves binary executable path from options, env, or profile candidates.
 */
export function resolveBinary(profile: AgyProfile, explicitBin?: string): string {
  if (explicitBin) return explicitBin;
  if (process.env.AGY_BIN) return process.env.AGY_BIN;
  for (const candidate of profile.binary.candidates) {
    let expanded = candidate;
    if (process.platform === 'win32') {
      expanded = candidate.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
    }
    return expanded;
  }
  return 'agy';
}

/**
 * Binary used to start runs. Prefers a candidate that actually exists (same lookup as the model
 * catalog and the login terminal), so a run does not fail with `spawn agy ENOENT` when agy lives
 * in %LOCALAPPDATA%\agy\bin but is not on this process's PATH (e.g. right after installing agy,
 * before Explorer picks up the new PATH).
 */
export function resolveRunnerBinary(profile: AgyProfile, explicitBin?: string): string {
  return findAgyBinary(profile, explicitBin) ?? resolveBinary(profile, explicitBin);
}

/**
 * Formats a user frame string based on the profile template and prompt text.
 */
export function formatUserFrame(
  template: string | Record<string, unknown>,
  prompt: string,
): string {
  if (typeof template === 'string') {
    if (template.includes('"{{prompt}}"')) {
      return template.replaceAll('"{{prompt}}"', JSON.stringify(prompt));
    }
    if (template.includes('{{prompt}}')) {
      const encoded = JSON.stringify(prompt);
      return template.replaceAll('{{prompt}}', encoded.slice(1, -1));
    }
    return template;
  }

  const serialized = JSON.stringify(template);
  if (serialized.includes('"{{prompt}}"')) {
    return serialized.replaceAll('"{{prompt}}"', JSON.stringify(prompt));
  }
  return JSON.stringify({
    ...template,
    message: { content: prompt },
  });
}

/**
 * Implementation of AgyRunnerPort that spawns and controls agy CLI processes.
 */
export class ProcessRunner implements AgyRunnerPort {
  constructor(
    private readonly profile: AgyProfile,
    private readonly defaultBin?: string,
  ) {}

  async start(options: ProcessRunnerOptions): Promise<ProcessRunnerProcess> {
    const bin = resolveRunnerBinary(this.profile, options.bin ?? this.defaultBin);
    const argv = buildArgv(this.profile, options);
    const runId = options.runId ?? createId('run');
    const profile = this.profile;

    let child: ChildProcess;
    try {
      child = spawn(bin, argv, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new AppError('AGY_SPAWN_ERROR', `Failed to spawn agy process: ${String(err)}`, {
        cause: err,
      });
    }

    // Capture immediate spawn errors (like ENOENT) emitted on next tick
    let initialError: Error | null = null;
    const initialErrorHandler = (err: Error) => {
      initialError = err;
    };
    child.once('error', initialErrorHandler);

    await new Promise((resolve) => setImmediate(resolve));
    child.removeListener('error', initialErrorHandler);

    if (initialError) {
      throw new AppError(
        'AGY_SPAWN_ERROR',
        `Failed to spawn agy process: ${(initialError as Error).message}`,
        { cause: initialError },
      );
    }

    const eventQueue = new AsyncEventQueue<AgentEvent>();

    let currentConversationId: string | null = null;
    let currentTerminal: AdaptResult['terminal'] | null = null;
    let currentUsage: TokenUsage | null = null;
    let isExitedClosed = false;

    let resolveExited: (res: { exitCode: number | null; signal: string | null }) => void;
    let rejectExited: (err: unknown) => void;
    const exitedPromise = new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolve, reject) => {
        resolveExited = resolve;
        rejectExited = reject;
      },
    );

    const adaptCtx = {
      runId,
      nextId: () => createId(),
      now: () => new Date().toISOString(),
      profile: this.profile,
    };

    const processLine = (line: string) => {
      const adaptResult = adapt(line, adaptCtx);
      if (adaptResult.conversationId && adaptResult.conversationId !== currentConversationId) {
        currentConversationId = adaptResult.conversationId;
        try {
          options.onConversationId?.(currentConversationId);
        } catch {
          // Listener errors must not break stream parsing
        }
      }
      if (adaptResult.usage) {
        currentUsage = adaptResult.usage;
      }
      if (adaptResult.terminal) {
        currentTerminal = adaptResult.terminal;
      }

      for (const ev of adaptResult.events) {
        eventQueue.push(ev);
      }

      if (adaptResult.permissionRequest) {
        const replyTemplate = this.profile.stream.permissionEvent?.replyTemplate ?? {
          event: 'permission_response',
          allow: true,
        };
        const replyStr =
          typeof replyTemplate === 'string' ? replyTemplate : JSON.stringify(replyTemplate);

        if (child.stdin && child.stdin.writable) {
          child.stdin.write(replyStr + '\n');
        }

        eventQueue.push({
          type: 'autoapprove.injected',
          layer: 'permission_event',
          detail: 'Auto-approved permission request via stream reply',
        });
      }
    };

    let stdoutBuffer = '';
    const handleChunk = (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length > 0) {
          processLine(line);
        }
      }
    };

    const flushBuffer = () => {
      if (stdoutBuffer.trim().length > 0) {
        const remaining = stdoutBuffer;
        stdoutBuffer = '';
        processLine(remaining);
      }
    };

    // Decode as a stream so multi-byte UTF-8 characters split across chunks stay intact
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', handleChunk);
    child.stdout?.on('end', () => {
      flushBuffer();
    });

    const handleExitClose = (code: number | null, signal: string | null) => {
      if (isExitedClosed) return;
      isExitedClosed = true;
      flushBuffer();
      eventQueue.close();
      resolveExited({ exitCode: code, signal });
    };

    child.on('close', (code, signal) => {
      handleExitClose(code, signal);
    });

    child.on('error', (err) => {
      eventQueue.error(err);
      if (!isExitedClosed) {
        isExitedClosed = true;
        rejectExited(err);
      }
    });

    // Check if process failed immediately during startup
    if (!child.pid) {
      throw new AppError('AGY_SPAWN_ERROR', 'Failed to obtain pid for spawned process');
    }

    const runnerProcess: ProcessRunnerProcess = {
      child,
      get pid() {
        return child.pid;
      },
      get events() {
        return eventQueue;
      },
      get conversationId() {
        return currentConversationId;
      },
      get terminal() {
        return currentTerminal;
      },
      get usage() {
        return currentUsage;
      },
      get exited() {
        return exitedPromise;
      },
      async send(text: string, images?: string[]): Promise<void> {
        if (!child.stdin || !child.stdin.writable) {
          throw new AppError('AGY_EXIT', 'Process stdin is not writable');
        }

        let prompt = text;
        if (images && images.length > 0) {
          if (
            profile.stream.imageInput?.supported &&
            profile.stream.imageInput.template
          ) {
            // Native format if supported
          } else {
            // Path injection fallback
            const paths = images.map((p) => `<image>${p}</image>`).join('\n');
            prompt = `${prompt}\n<images_input>\n${paths}\n</images_input>`;
          }
        }

        const frame = formatUserFrame(profile.stream.userFrameTemplate, prompt);

        await new Promise<void>((resolve, reject) => {
          child.stdin!.write(frame + '\n', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      },
      closeInput(): void {
        if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
          child.stdin.end();
        }
      },
      async kill(): Promise<void> {
        if (child.pid && isProcessAlive(child.pid)) {
          await killTree(child.pid);
        }
      },
    };

    return runnerProcess;
  }
}
