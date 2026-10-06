import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { AccountLoginSession } from '@agy-studio/contracts';
import type {
  LoginHandle,
  LoginPort,
  StartLoginOptions,
} from '../../services/ports/login.port.js';
import type { AgyProfile } from './profile/schema.js';
import { loadProfile } from './profile/loader.js';
import { findAgyBinary } from './catalog.js';
import { resolveBinary } from './process.js';
import { createId } from '../../utils/ids.js';
import type { Logger } from 'pino';
import { logger as defaultLogger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface LaunchOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface TerminalProcess {
  pid?: number;
  kill(): void | Promise<void>;
}

export type TerminalLauncher = (
  command: string,
  args: string[],
  options?: LaunchOptions,
) => Promise<TerminalProcess> | TerminalProcess;

/**
 * `cmd.exe /c start "" "<command>" <args...>`, passed verbatim. The command is always quoted
 * (agy usually lives under C:\Users\<name>\..., and user names may contain spaces); arguments are
 * quoted only when they contain whitespace or quotes.
 */
export function buildWindowsStartArgs(command: string, args: string[]): string[] {
  const quote = (value: string) => `"${value.replace(/"/g, '\\"')}"`;
  return [
    '/c',
    'start',
    '""',
    quote(command),
    ...args.map((arg) => (/[\s"]/.test(arg) ? quote(arg) : arg)),
  ];
}

export const defaultTerminalLauncher: TerminalLauncher = (command, args, options) => {
  let child: ChildProcess;
  if (process.platform === 'win32') {
    // Windows requires cmd.exe /c start "" <command> <args...> to open in a new console window
    const cmdArgs = buildWindowsStartArgs(command, args);
    child = spawn('cmd.exe', cmdArgs, {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: true,
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    child = spawn('open', ['-a', 'Terminal', command, '--args', ...args], {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
  } else {
    child = spawn('x-terminal-emulator', ['-e', command, ...args], {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
  }

  return {
    pid: child.pid,
    kill: () => {
      try {
        if (child.pid) {
          if (process.platform === 'win32') {
            try {
              spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
            } catch {
              child.kill();
            }
          } else {
            child.kill('SIGTERM');
          }
        }
      } catch {
        // ignore
      }
    },
  };
};

function getDefaultProfile(): AgyProfile {
  const candidates = [
    path.resolve(__dirname, '../../../agy-profile.json'),
    path.resolve(process.cwd(), 'backend/agy-profile.json'),
    path.resolve(process.cwd(), 'agy-profile.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return loadProfile(candidate);
      } catch {
        // ignore and try next
      }
    }
  }
  return {
    agyVersion: '1.2.12',
    discoveredAt: new Date().toISOString(),
    binary: {
      candidates: ['agy', 'agy.exe'],
    },
    stream: {
      userFrameTemplate: '{"event":"user","message":{"content":"{{prompt}}"}}',
      multiTurnStdin: false,
      eventTypeMap: { init: 'init', step_update: 'step_update', result: 'result' },
      permissionEvent: null,
      imageInput: { supported: false, template: null },
    },
    paths: {
      dataRoots: [],
      conversationDirPattern: '',
      transcriptRelPath: '',
    },
    settings: {
      files: [],
      alwaysProceed: {
        jsonPath: 'toolPermission',
        value: 'always-proceed',
      },
      statusline: {
        jsonPath: 'statusline',
      },
    },
    credentials: {
      preferredIsolation: 'credential_snapshot',
      homeEnvVars: [],
      wincredTargetPatterns: ['gemini:antigravity'],
      credentialFiles: [],
    },
    login: {
      argv: [],
      authUrlPattern: 'https?://[^\\s]+',
      successPatterns: ['Logged in as', 'Authentication successful', 'Welcome'],
      failurePatterns: ['Authentication failed', 'Login cancelled', 'Error: '],
    },
    quota: {
      statuslineInHeadless: false,
      usageCommand: '/usage',
      creditsCommand: '/credits',
      usageParser: 'text-v1',
    },
    catalog: {
      versionArgv: ['--version'],
      modelsArgv: ['models'],
      modelsParser: 'text-v1',
      modes: ['accept-edits', 'plan'],
    },
  };
}

export class TerminalLoginHandle implements LoginHandle {
  readonly loginId: string;
  private _session: AccountLoginSession;
  private readonly terminalProcess: TerminalProcess;
  private readonly completionPromise: Promise<AccountLoginSession>;
  private completionResolve!: (session: AccountLoginSession) => void;
  private isCancelled = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(params: {
    loginId: string;
    terminalProcess: TerminalProcess;
    timeoutMs?: number;
    initialSession?: AccountLoginSession;
  }) {
    this.loginId = params.loginId;
    this.terminalProcess = params.terminalProcess;
    this._session = params.initialSession ?? {
      loginId: this.loginId,
      status: 'awaiting_browser',
      authUrl: null,
      email: null,
      error: null,
    };

    this.completionPromise = new Promise<AccountLoginSession>((resolve) => {
      this.completionResolve = resolve;
    });

    if (params.timeoutMs && params.timeoutMs > 0) {
      this.timer = setTimeout(() => {
        if (!this.isCancelled && this._session.status === 'awaiting_browser') {
          this._session = {
            ...this._session,
            status: 'failed',
            error: 'Login timed out',
          };
          try {
            this.terminalProcess.kill();
          } catch {
            // ignore
          }
          this.completionResolve(this._session);
        }
      }, params.timeoutMs);
    }
  }

  get session(): AccountLoginSession {
    return this._session;
  }

  updateSession(session: AccountLoginSession): void {
    this._session = session;
  }

  async waitForAuthUrl(): Promise<string> {
    return '';
  }

  waitForCompletion(): Promise<AccountLoginSession> {
    return this.completionPromise;
  }

  async cancel(): Promise<void> {
    if (this.isCancelled) return;
    this.isCancelled = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await this.terminalProcess.kill();
    } catch {
      // ignore
    }
    this._session = {
      ...this._session,
      status: 'cancelled',
    };
    this.completionResolve(this._session);
  }

  complete(session: AccountLoginSession): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._session = session;
    this.completionResolve(session);
  }
}

export interface LoginTerminalOptions {
  profile?: AgyProfile;
  binaryPath?: string;
  terminalLauncher?: TerminalLauncher;
  logger?: Logger;
}

export class LoginTerminal implements LoginPort {
  private readonly profile: AgyProfile;
  private readonly binaryPath?: string;
  private readonly launcher: TerminalLauncher;
  private readonly logger: Logger;

  constructor(options?: LoginTerminalOptions) {
    this.profile = options?.profile ?? getDefaultProfile();
    this.binaryPath = options?.binaryPath;
    this.launcher = options?.terminalLauncher ?? defaultTerminalLauncher;
    this.logger = options?.logger ?? defaultLogger;
  }

  async startLogin(options: StartLoginOptions): Promise<TerminalLoginHandle> {
    const loginId = createId('login');
    const argv = this.profile.login?.argv ?? [];
    const bin =
      findAgyBinary(this.profile, this.binaryPath) ??
      resolveBinary(this.profile, this.binaryPath);

    this.logger.info(
      { loginId, bin, argv, accountName: options.accountName },
      'Launching login terminal',
    );

    const terminalProcess = await this.launcher(bin, argv, {
      env: { ...process.env, ...options.env },
    });

    return new TerminalLoginHandle({
      loginId,
      terminalProcess,
      timeoutMs: options.timeoutMs,
    });
  }

  async open(options: StartLoginOptions): Promise<TerminalLoginHandle> {
    return this.startLogin(options);
  }
}
