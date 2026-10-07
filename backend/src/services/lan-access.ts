import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LanAccessStatus } from '@agy-studio/contracts';

export interface LanListenerPort {
  readonly running: boolean;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

export interface LanAccessServiceOptions {
  dataDir: string;
  port: number;
  listener: LanListenerPort;
  addresses: () => Array<{ name: string; address: string }>;
  /** HOST / AGY_STUDIO_TOKEN already expose the server: the in-app switch is off limits. */
  managedByEnv?: boolean;
  logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

interface StoredState {
  enabled: boolean;
  token: string;
}

function newToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

/** Constant-time comparison so the access code cannot be guessed byte by byte. */
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Lets phones and other computers on the same network use AGY Studio. Off by default. When on,
 * a second listener accepts LAN connections; every API / WebSocket request arriving through it must
 * carry the access code (`Authorization: Bearer`, or `?token=` for WebSockets and links).
 * Requests from this computer are unaffected.
 */
export class LanAccessService {
  private state: StoredState;
  private lastError: string | null = null;
  private readonly file: string;

  constructor(private readonly options: LanAccessServiceOptions) {
    this.file = path.join(options.dataDir, 'lan-access.json');
    this.state = this.load();
  }

  /** Re-opens the listener at startup if LAN access was left on. */
  async restore(): Promise<void> {
    if (this.state.enabled && !this.options.managedByEnv) await this.open();
  }

  verifyToken(token: string | null | undefined): boolean {
    return Boolean(token) && sameToken(token as string, this.state.token);
  }

  status(fromThisComputer: boolean): LanAccessStatus {
    const { port } = this.options;
    return {
      available: !this.options.managedByEnv,
      enabled: this.state.enabled,
      listening: this.options.listener.running,
      error: this.lastError,
      port,
      addresses: this.options.addresses().map(({ name, address }) => ({
        name,
        address,
        url: `http://${address}:${port}/${fromThisComputer ? `?token=${this.state.token}` : ''}`,
      })),
      canManage: fromThisComputer && !this.options.managedByEnv,
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.state = { ...this.state, enabled };
    this.save();
    if (enabled) {
      await this.open();
    } else {
      this.lastError = null;
      await this.options.listener.stop();
      this.options.logger?.info({}, 'LAN access turned off');
    }
  }

  /** Issues a new access code and drops every LAN connection made with the old one. */
  async regenerateToken(): Promise<void> {
    this.state = { ...this.state, token: newToken() };
    this.save();
    if (this.options.listener.running) {
      await this.options.listener.stop();
      await this.open();
    }
  }

  async close(): Promise<void> {
    await this.options.listener.stop();
  }

  private async open(): Promise<void> {
    try {
      await this.options.listener.start(this.options.port);
      this.lastError = null;
      this.options.logger?.info({ port: this.options.port }, 'LAN access listening on 0.0.0.0');
    } catch (err) {
      this.lastError = `无法在局域网端口 ${this.options.port} 上监听：${(err as Error).message}`;
      this.options.logger?.warn({ err }, 'Failed to open LAN listener');
    }
  }

  private load(): StoredState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoredState>;
      if (typeof parsed.token === 'string' && parsed.token.length >= 16) {
        return { enabled: parsed.enabled === true, token: parsed.token };
      }
    } catch {
      // first run or unreadable: start disabled with a fresh code
    }
    return { enabled: false, token: newToken() };
  }

  private save(): void {
    fs.mkdirSync(this.options.dataDir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}
