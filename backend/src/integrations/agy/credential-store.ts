import fs from 'node:fs';
import path from 'node:path';
import { Entry } from '@napi-rs/keyring';
import type { CredentialPort, CredentialSnapshot } from '../../services/ports/credential.port.js';
import type { AgyProfile } from './profile/schema.js';
import { resolveDataDir } from '../../utils/config.js';
import { AppError } from '../../utils/errors.js';
import { dpapi as defaultDpapi, type DpapiPort } from './dpapi.js';

export interface KeyringEntry {
  getSecret(): Uint8Array | number[] | null | undefined;
  setSecret(secret: Uint8Array): void;
  deleteCredential(): boolean;
}

export interface KeyringProvider {
  getEntry(target: string, service: string, username: string): KeyringEntry;
}

export const defaultKeyringProvider: KeyringProvider = {
  getEntry: (target, service, username) => {
    return Entry.withTarget(target, service, username);
  },
};

export class MemoryKeyringProvider implements KeyringProvider {
  private readonly store = new Map<string, Buffer>();

  getEntry(target: string, _service?: string, _username?: string): KeyringEntry {
    return {
      getSecret: () => {
        const val = this.store.get(target);
        return val ? new Uint8Array(val) : null;
      },
      setSecret: (secret: Uint8Array) => {
        this.store.set(target, Buffer.from(secret));
      },
      deleteCredential: () => {
        return this.store.delete(target);
      },
    };
  }

  clear(): void {
    this.store.clear();
  }

  set(target: string, secret: Buffer): void {
    this.store.set(target, secret);
  }

  has(target: string): boolean {
    const val = this.store.get(target);
    return !!val && val.length > 0;
  }
}

export interface IdTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  [key: string]: unknown;
}

export function parseJwtPayload(jwt: string): IdTokenClaims | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
      b64 += '=';
    }
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractClaimsFromSecret(secretBytes: Buffer | Uint8Array): IdTokenClaims | null {
  try {
    const raw = Buffer.from(secretBytes);
    if (raw.length === 0) return null;
    const jsonStr = raw.toString('utf-8');
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.id_token === 'string') {
      return parseJwtPayload(parsed.id_token);
    }
    return null;
  } catch {
    return null;
  }
}

export function extractClaimsFromSnapshot(snapshot: CredentialSnapshot): IdTokenClaims | null {
  for (const rawB64 of Object.values(snapshot.targets)) {
    const bytes = Buffer.from(rawB64, 'base64');
    const claims = extractClaimsFromSecret(bytes);
    if (claims) return claims;
  }
  return null;
}

export interface CredentialStoreOptions {
  profile?: {
    credentials?: Partial<AgyProfile['credentials']>;
  };
  dataDir?: string;
  dpapi?: DpapiPort;
  keyringProvider?: KeyringProvider;
}

interface ParsedTarget {
  target: string;
  service: string;
  username: string;
}

function parseTargetPattern(pattern: string): ParsedTarget {
  if (pattern.includes(':')) {
    const idx = pattern.indexOf(':');
    return {
      target: pattern,
      service: pattern.slice(0, idx),
      username: pattern.slice(idx + 1),
    };
  }
  return {
    target: pattern,
    service: pattern,
    username: pattern,
  };
}

export class CredentialStore implements CredentialPort {
  private readonly wincredTargetPatterns: string[];
  private readonly credentialFiles: string[];
  private readonly dataDir: string;
  private readonly dpapi: DpapiPort;
  private readonly keyringProvider: KeyringProvider;

  constructor(options?: CredentialStoreOptions) {
    this.wincredTargetPatterns =
      options?.profile?.credentials?.wincredTargetPatterns ?? ['gemini:antigravity'];
    this.credentialFiles = options?.profile?.credentials?.credentialFiles ?? [];
    this.dataDir = options?.dataDir ?? resolveDataDir();
    this.dpapi = options?.dpapi ?? defaultDpapi;
    this.keyringProvider = options?.keyringProvider ?? defaultKeyringProvider;
  }

  private getEntryForPattern(pattern: string): KeyringEntry {
    const parsed = parseTargetPattern(pattern);
    return this.keyringProvider.getEntry(parsed.target, parsed.service, parsed.username);
  }

  private resolveFilePath(filePathTemplate: string): string {
    let resolved = filePathTemplate;
    if (process.env.USERPROFILE) {
      resolved = resolved.replace(/%USERPROFILE%/gi, process.env.USERPROFILE);
    }
    if (process.env.APPDATA) {
      resolved = resolved.replace(/%APPDATA%/gi, process.env.APPDATA);
    }
    if (process.env.LOCALAPPDATA) {
      resolved = resolved.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA);
    }
    if (process.env.HOME) {
      resolved = resolved.replace(/%HOME%/gi, process.env.HOME);
    }
    return path.resolve(resolved);
  }

  /**
   * Check whether any live credentials currently exist in the system store / file locations.
   */
  async isPresent(): Promise<boolean> {
    for (const pattern of this.wincredTargetPatterns) {
      try {
        const entry = this.getEntryForPattern(pattern);
        const secret = entry.getSecret();
        if (secret) {
          const buf = Buffer.from(secret);
          if (buf.length > 0) {
            return true;
          }
        }
      } catch {
        // Ignored, check next pattern
      }
    }

    for (const fileTemplate of this.credentialFiles) {
      try {
        const resolved = this.resolveFilePath(fileTemplate);
        if (fs.existsSync(resolved)) {
          const stat = fs.statSync(resolved);
          if (stat.size > 0) {
            return true;
          }
        }
      } catch {
        // Ignored
      }
    }

    return false;
  }

  /**
   * Read raw live claims from current live credentials.
   */
  async readLiveClaims(): Promise<IdTokenClaims | null> {
    for (const pattern of this.wincredTargetPatterns) {
      try {
        const entry = this.getEntryForPattern(pattern);
        const secret = entry.getSecret();
        if (secret) {
          const buf = Buffer.from(secret);
          if (buf.length > 0) {
            const claims = extractClaimsFromSecret(buf);
            if (claims) return claims;
          }
        }
      } catch {
        // Ignored
      }
    }
    return null;
  }

  /**
   * Capture in-memory snapshot of current live credentials without writing to disk.
   */
  async takeLiveSnapshot(): Promise<CredentialSnapshot> {
    const targets: Record<string, string> = {};
    const files: Record<string, string> = {};

    for (const pattern of this.wincredTargetPatterns) {
      try {
        const entry = this.getEntryForPattern(pattern);
        const secret = entry.getSecret();
        if (secret) {
          const buf = Buffer.from(secret);
          if (buf.length > 0) {
            targets[pattern] = buf.toString('base64');
          }
        }
      } catch {
        // Ignored
      }
    }

    for (const fileTemplate of this.credentialFiles) {
      try {
        const resolved = this.resolveFilePath(fileTemplate);
        if (fs.existsSync(resolved)) {
          const content = fs.readFileSync(resolved);
          files[fileTemplate] = content.toString('base64');
        }
      } catch {
        // Ignored
      }
    }

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      targets,
      files,
    };
  }

  getSnapshotPath(accountName: string): string {
    return path.join(this.dataDir, 'credentials', accountName, 'snapshot.enc');
  }

  hasSnapshot(accountName: string): boolean {
    const filePath = this.getSnapshotPath(accountName);
    return fs.existsSync(filePath);
  }

  /**
   * Reads and decrypts snapshot from disk.
   */
  async loadSnapshot(accountName: string): Promise<CredentialSnapshot> {
    const filePath = this.getSnapshotPath(accountName);
    if (!fs.existsSync(filePath)) {
      throw new AppError('NOT_FOUND', `Credential snapshot for account "${accountName}" not found`);
    }

    const encryptedData = await fs.promises.readFile(filePath);
    const decryptedData = await this.dpapi.unprotect(encryptedData);
    try {
      const snapshot: CredentialSnapshot = JSON.parse(decryptedData.toString('utf-8'));
      return snapshot;
    } catch (err) {
      throw new AppError('INTERNAL', `Failed to parse credential snapshot for "${accountName}": ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  /**
   * Capture a snapshot of current live credentials and encrypts it to disk.
   */
  async snapshot(accountName: string): Promise<CredentialSnapshot> {
    const snapshotObj = await this.takeLiveSnapshot();

    const snapshotDir = path.join(this.dataDir, 'credentials', accountName);
    await fs.promises.mkdir(snapshotDir, { recursive: true });

    const rawJson = Buffer.from(JSON.stringify(snapshotObj, null, 2), 'utf-8');
    const encrypted = await this.dpapi.protect(rawJson);

    const snapshotPath = this.getSnapshotPath(accountName);
    await fs.promises.writeFile(snapshotPath, encrypted);

    return snapshotObj;
  }

  /**
   * Restore a snapshot into live credentials locations and verify success.
   */
  async restore(snapshot: CredentialSnapshot): Promise<void> {
    // 1. Restore targets
    for (const [targetPattern, b64Payload] of Object.entries(snapshot.targets)) {
      const entry = this.getEntryForPattern(targetPattern);
      const secretBytes = Buffer.from(b64Payload, 'base64');
      entry.setSecret(secretBytes);

      // Verify write succeeded
      const readBack = entry.getSecret();
      if (!readBack) {
        throw new AppError('INTERNAL', `Failed to verify keyring write for target "${targetPattern}": readBack is null`);
      }
      const readBuf = Buffer.from(readBack);
      if (!readBuf.equals(secretBytes)) {
        throw new AppError('INTERNAL', `Failed to verify keyring write for target "${targetPattern}": content mismatch`);
      }
    }

    // 2. Restore files
    for (const [fileTemplate, b64Payload] of Object.entries(snapshot.files)) {
      const resolved = this.resolveFilePath(fileTemplate);
      const dir = path.dirname(resolved);
      await fs.promises.mkdir(dir, { recursive: true });
      const fileBytes = Buffer.from(b64Payload, 'base64');
      await fs.promises.writeFile(resolved, fileBytes);
    }
  }

  /**
   * Clear live credentials from system store and configured files.
   */
  async clear(): Promise<void> {
    for (const pattern of this.wincredTargetPatterns) {
      try {
        const entry = this.getEntryForPattern(pattern);
        entry.deleteCredential();
      } catch (err: unknown) {
        const msg = String((err as { message?: string })?.message || err);
        if (
          msg.includes('NotFound') ||
          msg.includes('not found') ||
          msg.includes('The specified item could not be found')
        ) {
          // Already removed
        } else {
          throw new AppError('INTERNAL', `Failed to delete keyring credential for "${pattern}": ${msg}`, {
            cause: err,
          });
        }
      }
    }

    for (const fileTemplate of this.credentialFiles) {
      try {
        const resolved = this.resolveFilePath(fileTemplate);
        if (fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch (err: unknown) {
        if ((err as { code?: string })?.code !== 'ENOENT') {
          throw new AppError(
            'INTERNAL',
            `Failed to delete credential file "${fileTemplate}": ${(err as Error).message}`,
            { cause: err },
          );
        }
      }
    }

    if (await this.isPresent()) {
      throw new AppError('INTERNAL', 'Failed to clear live credentials: credentials are still present');
    }
  }

  /**
   * Delete snapshot file and directory from disk for an account.
   */
  async deleteSnapshot(accountName: string): Promise<void> {
    const snapshotDir = path.join(this.dataDir, 'credentials', accountName);
    if (fs.existsSync(snapshotDir)) {
      await fs.promises.rm(snapshotDir, { recursive: true, force: true });
    }
  }
}
