import type { AgentEvent, ISODateString, TranscriptStep, TranscriptToolCall } from '@agy-studio/contracts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlTail } from '../../utils/jsonl-tail.js';
import type { PathsConfig } from './profile/schema.js';

export interface TailOptions {
  fromStep?: number;
  homeDir?: string;
  dataRoot?: string;
  transcriptPath?: string;
  pollIntervalMs?: number;
}

export interface TailHandle extends AsyncIterable<TranscriptStep> {
  steps: AsyncIterable<TranscriptStep>;
  stop(): void;
  [Symbol.asyncIterator](): AsyncIterator<TranscriptStep>;
}

/**
 * Expands %ENV_VAR% tokens in path strings.
 */
export function expandPathTokens(template: string, envOverrides?: Record<string, string>): string {
  return template.replace(/%([^%]+)%/g, (_, varName) => {
    if (envOverrides && envOverrides[varName] !== undefined) {
      return envOverrides[varName];
    }
    if (process.env[varName] !== undefined) {
      return process.env[varName]!;
    }
    if (varName === 'USERPROFILE' || varName === 'HOME') {
      return process.env.USERPROFILE || process.env.HOME || os.homedir();
    }
    if (varName === 'LOCALAPPDATA') {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    }
    if (varName === 'APPDATA') {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    }
    return '';
  });
}

/**
 * Resolves the absolute path to a conversation's transcript.jsonl file.
 */
export function resolveTranscriptPath(
  conversationId: string,
  options?: { dataRoot?: string; homeDir?: string },
  pathsConfig?: PathsConfig,
): string {
  const relPath = pathsConfig?.transcriptRelPath || 'transcript.jsonl';
  const rawPattern = pathsConfig?.conversationDirPattern;

  if (options?.homeDir) {
    const home = options.homeDir;
    if (rawPattern) {
      const envOverrides = {
        USERPROFILE: home,
        HOME: home,
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
        APPDATA: path.join(home, 'AppData', 'Roaming'),
      };
      const convDir = expandPathTokens(rawPattern, envOverrides).replace('{{conversationId}}', conversationId);
      return path.join(convDir, relPath);
    }
    return path.join(home, '.antigravity', 'conversations', conversationId, relPath);
  }

  if (options?.dataRoot) {
    const dataRoot = options.dataRoot;

    if (
      fs.existsSync(path.join(dataRoot, '.antigravity', 'conversations')) ||
      (fs.existsSync(path.join(dataRoot, '.antigravity')) && !fs.existsSync(path.join(dataRoot, 'conversations')))
    ) {
      if (rawPattern) {
        const envOverrides = {
          USERPROFILE: dataRoot,
          HOME: dataRoot,
          LOCALAPPDATA: path.join(dataRoot, 'AppData', 'Local'),
          APPDATA: path.join(dataRoot, 'AppData', 'Roaming'),
        };
        const convDir = expandPathTokens(rawPattern, envOverrides).replace('{{conversationId}}', conversationId);
        return path.join(convDir, relPath);
      }
      return path.join(dataRoot, '.antigravity', 'conversations', conversationId, relPath);
    }

    if (rawPattern && pathsConfig?.dataRoots?.[0]) {
      const rootPattern = pathsConfig.dataRoots[0];
      const normalizedRaw = rawPattern.replace(/\\/g, '/');
      const normalizedRoot = rootPattern.replace(/\\/g, '/');

      if (normalizedRaw.startsWith(normalizedRoot)) {
        const relToRoot = normalizedRaw.slice(normalizedRoot.length).replace(/^\/+/, '');
        const substitutedRel = relToRoot.replace('{{conversationId}}', conversationId);
        return path.join(dataRoot, substitutedRel, relPath);
      }

      const convDir = expandPathTokens(rawPattern).replace('{{conversationId}}', conversationId);
      return path.join(convDir, relPath);
    }

    return path.join(dataRoot, 'conversations', conversationId, relPath);
  }

  if (rawPattern) {
    const pattern = expandPathTokens(rawPattern);
    const convDir = pattern.replace('{{conversationId}}', conversationId);
    return path.join(convDir, relPath);
  }

  const defaultHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(defaultHome, '.antigravity', 'conversations', conversationId, relPath);
}

/**
 * Parses a single JSON line into a TranscriptStep, returning null if invalid.
 */
export function parseLine(line: string): TranscriptStep | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let raw: Record<string, any>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    raw = parsed;
  } catch {
    return null;
  }

  // 1. stepIndex
  let stepIndex = 0;
  if (typeof raw.stepIndex === 'number') {
    stepIndex = raw.stepIndex;
  } else if (typeof raw.step_index === 'number') {
    stepIndex = raw.step_index;
  } else if (typeof raw.index === 'number') {
    stepIndex = raw.index;
  }

  // 2. type
  let type = 'unknown';
  if (typeof raw.type === 'string') {
    type = raw.type;
  } else if (typeof raw.step_type === 'string') {
    type = raw.step_type;
  } else if (typeof raw.kind === 'string') {
    type = raw.kind;
  } else if (raw.context_kind === 'CONTEXT_KIND_MODEL_THOUGHT') {
    type = 'thought';
  }

  // 3. status
  let status: string | null = null;
  if (typeof raw.status === 'string') {
    status = raw.status;
  } else if (typeof raw.state === 'string') {
    status = raw.state;
  }

  // 4. createdAt
  let createdAt: ISODateString | null = null;
  if (typeof raw.createdAt === 'string') {
    createdAt = raw.createdAt;
  } else if (typeof raw.timestamp === 'string') {
    createdAt = raw.timestamp;
  } else if (typeof raw.created_at === 'string') {
    createdAt = raw.created_at;
  } else if (typeof raw.ts === 'string') {
    createdAt = raw.ts;
  }

  // 5. content
  let content: string | null = null;
  if (typeof raw.content === 'string') {
    content = raw.content;
  } else if (typeof raw.text === 'string') {
    content = raw.text;
  } else if (typeof raw.text_delta === 'string') {
    content = raw.text_delta;
  } else if (typeof raw.message === 'string') {
    content = raw.message;
  } else if (raw.message && typeof raw.message === 'object' && typeof raw.message.content === 'string') {
    content = raw.message.content;
  } else if (raw.content && typeof raw.content === 'object' && typeof raw.content.text === 'string') {
    content = raw.content.text;
  } else if (Array.isArray(raw.content)) {
    const texts = raw.content
      .filter((c: any) => c && typeof c === 'object' && typeof c.text === 'string')
      .map((c: any) => c.text);
    if (texts.length > 0) {
      content = texts.join('\n');
    }
  }

  // 6. thinking
  let thinking: string | null = null;
  if (typeof raw.thinking === 'string') {
    thinking = raw.thinking;
  } else if (typeof raw.thought === 'string') {
    thinking = raw.thought;
  } else if (
    type === 'thought' ||
    type === 'thinking' ||
    raw.context_kind === 'CONTEXT_KIND_MODEL_THOUGHT'
  ) {
    thinking = content;
  }

  // 7. toolCalls
  const toolCalls: TranscriptToolCall[] = [];
  if (Array.isArray(raw.toolCalls)) {
    for (const tc of raw.toolCalls) {
      if (tc && typeof tc === 'object' && typeof tc.name === 'string') {
        toolCalls.push({
          name: tc.name,
          args: (tc.args && typeof tc.args === 'object' ? tc.args : {}) as Record<string, unknown>,
        });
      }
    }
  } else if (Array.isArray(raw.tool_calls)) {
    for (const tc of raw.tool_calls) {
      if (tc && typeof tc === 'object') {
        const name = tc.name ?? tc.function?.name ?? 'unknown';
        let args: Record<string, unknown> = {};
        if (tc.args && typeof tc.args === 'object') {
          args = tc.args;
        } else if (tc.function?.arguments) {
          if (typeof tc.function.arguments === 'string') {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = { raw: tc.function.arguments };
            }
          } else if (typeof tc.function.arguments === 'object') {
            args = tc.function.arguments;
          }
        }
        toolCalls.push({ name, args });
      }
    }
  } else if (typeof raw.tool_name === 'string') {
    const args = (raw.tool_info?.parameters ?? raw.tool_parameters ?? raw.args ?? {}) as Record<string, unknown>;
    toolCalls.push({
      name: raw.tool_name,
      args: typeof args === 'object' && args !== null ? args : {},
    });
  }

  // 8. error
  let error: string | null = null;
  if (typeof raw.error === 'string') {
    error = raw.error;
  } else if (raw.error && typeof raw.error === 'object') {
    error = raw.error.message ? String(raw.error.message) : JSON.stringify(raw.error);
  }

  return {
    stepIndex,
    type,
    status,
    createdAt,
    content,
    thinking,
    toolCalls,
    error,
  };
}

/**
 * Converts a TranscriptStep into unified AgentEvent(s).
 * - role: 'main' with thinking -> thinking.delta(source='transcript')
 * - role: 'subagent' -> subagent.step
 */
export function toEvents(
  step: TranscriptStep,
  role: 'main' | 'subagent',
  conversationId: string,
): AgentEvent[] {
  if (role === 'subagent') {
    return [
      {
        type: 'subagent.step',
        conversationId,
        step,
      },
    ];
  }

  if (step.thinking && step.thinking.length > 0) {
    return [
      {
        type: 'thinking.delta',
        blockId: `thinking-${conversationId}-${step.stepIndex}`,
        source: 'transcript',
        text: step.thinking,
      },
    ];
  }

  return [];
}

/**
 * Tails a conversation's transcript file incrementally.
 * Polls every 300ms if file does not exist or has no new lines.
 * Deduplicates by stepIndex. Calling stop() releases all resources immediately.
 */
export function tail(
  conversationIdOrPath: string,
  options?: TailOptions,
  pathsConfig?: PathsConfig,
): TailHandle {
  const pollIntervalMs = options?.pollIntervalMs ?? 300;
  const fromStep = options?.fromStep ?? 0;

  let targetPath: string;
  if (options?.transcriptPath) {
    targetPath = options.transcriptPath;
  } else if (
    conversationIdOrPath.endsWith('.jsonl') ||
    path.isAbsolute(conversationIdOrPath)
  ) {
    targetPath = conversationIdOrPath;
  } else {
    targetPath = resolveTranscriptPath(conversationIdOrPath, options, pathsConfig);
  }

  const jsonlTail = new JsonlTail(targetPath, 0);
  const seenStepIndices = new Set<number>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let wakeUp: (() => void) | null = null;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (wakeUp !== null) {
      const fn = wakeUp;
      wakeUp = null;
      fn();
    }
  }

  async function* iterate(): AsyncGenerator<TranscriptStep, void, unknown> {
    try {
      while (!stopped) {
        let lines: string[] = [];
        try {
          const res = await jsonlTail.read();
          lines = res.lines;
        } catch {
          // Ignore transient read errors
        }

        for (const line of lines) {
          if (stopped) break;
          const step = parseLine(line);
          if (step !== null) {
            if (step.stepIndex >= fromStep && !seenStepIndices.has(step.stepIndex)) {
              seenStepIndices.add(step.stepIndex);
              yield step;
            }
          }
        }

        if (stopped) break;

        // Wait for poll interval or early wakeup on stop()
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
          timer = setTimeout(() => {
            timer = null;
            wakeUp = null;
            resolve();
          }, pollIntervalMs);
        });
      }
    } finally {
      stop();
    }
  }

  const generator = iterate();

  const handle: TailHandle = {
    get steps() {
      return this;
    },
    stop,
    [Symbol.asyncIterator]() {
      return generator;
    },
  };

  return handle;
}
