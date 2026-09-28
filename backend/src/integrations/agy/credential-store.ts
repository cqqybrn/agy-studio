import fs from 'node:fs';
import path from 'node:path';
import type { CredentialPort, CredentialSnapshot } from '../../services/ports/credential.port.js';
import type { AgyProfile } from './profile/schema.js';
import { resolveDataDir } from '../../utils/config.js';
import { AppError } from '../../utils/errors.js';
import { dpapi as defaultDpapi, type DpapiPort } from './dpapi.js';
import { WindowsCredentialManager, type WinCredPort } from './wincred.js';

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
  wincred?: WinCredPort;
}

/** "gemini:antigravity" -> "antigravity", matching the UserName go-keyring writes. */
export function defaultUserNameForTarget(target: string): string {
  const idx = target.indexOf(':');
  return idx >= 0 ? target.slice(idx + 1) : target;
}

export class CredentialStore implements CredentialPort {
  private readonly wincredTargetPatterns: string[];
  private readonly credentialFiles: string[];
  private readonly dataDir: string;
  private readonly dpapi: DpapiPort;
  private readonly wincred: WinCredPort;

  constructor(options?: CredentialStoreOptions) {
    this.wincredTargetPatterns =
      options?.profile?.credentials?.wincredTargetPatterns ?? ['gemini:antigravity'];
    this.credentialFiles = options?.profile?.credentials?.credentialFiles ?? [];
    this.dataDir = options?.dataDir ?? resolveDataDir();
    this.dpapi = options?.dpapi ?? defaultDpapi;
    this.wincred = options?.wincred ?? new WindowsCredentialManager();
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
    // Read errors propagate: reporting "absent" on a failed read would let callers
    // skip the live backup and then clear() a credential that is actually there.
    for (const pattern of this.wincredTargetPatterns) {
      const res = await this.wincred.read(pattern);
      if (res.status === 'ok') {
        return true;
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
        const res = await this.wincred.read(pattern);
        if (res.status === 'ok') {
          const claims = extractClaimsFromSecret(res.data);
          if (claims) return claims;
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
    const targetUserNames: Record<string, string> = {};
    const files: Record<string, string> = {};

    for (const pattern of this.wincredTargetPatterns) {
      const res = await this.wincred.read(pattern);
      if (res.status !== 'ok') {
        throw new AppError(
          'AGY_NOT_AUTHENTICATED',
          res.status === 'missing'
            ? `Live credential "${pattern}" does not exist; log in to agy first`
            : `Live credential "${pattern}" exists but is empty; log in to agy again`,
          { details: { target: pattern, reason: res.status } },
        );
      }
      targets[pattern] = res.data.toString('base64');
      targetUserNames[pattern] = res.userName ?? defaultUserNameForTarget(pattern);
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
      targetUserNames,
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
  /**
   * Throws unless every configured target is present in the snapshot and every target payload
   * decodes to a non-empty blob. Performs no writes.
   */
  assertRestorable(snapshot: CredentialSnapshot): void {
    const targets = snapshot?.targets ?? {};
    for (const pattern of this.wincredTargetPatterns) {
      if (!Object.prototype.hasOwnProperty.call(targets, pattern)) {
        throw new AppError('INTERNAL', `Credential snapshot has no payload for target "${pattern}"; refusing to restore`, {
          details: { target: pattern, reason: 'missing_payload' },
        });
      }
    }
    for (const [target, b64Payload] of Object.entries(targets)) {
      if (typeof b64Payload !== 'string' || Buffer.from(b64Payload, 'base64').length === 0) {
        throw new AppError('INTERNAL', `Credential snapshot payload for target "${target}" is empty; refusing to restore`, {
          details: { target, reason: 'empty_payload' },
        });
      }
    }
  }

  async restore(snapshot: CredentialSnapshot): Promise<void> {
    this.assertRestorable(snapshot);

    // 1. Restore targets
    for (const [targetPattern, b64Payload] of Object.entries(snapshot.targets)) {
      const secretBytes = Buffer.from(b64Payload, 'base64');
      const userName = snapshot.targetUserNames?.[targetPattern] || defaultUserNameForTarget(targetPattern);
      await this.wincred.write(targetPattern, userName, secretBytes);

      const readBack = await this.wincred.read(targetPattern);
      if (readBack.status !== 'ok' || readBack.data.length === 0) {
        throw new AppError(
          'INTERNAL',
          `Failed to verify credential write for target "${targetPattern}": read back ${readBack.status === 'ok' ? 'empty' : readBack.status}`,
        );
      }
      if (!readBack.data.equals(secretBytes)) {
        throw new AppError('INTERNAL', `Failed to verify credential write for target "${targetPattern}": content mismatch`);
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
        await this.wincred.delete(pattern);
      } catch (err: unknown) {
        throw new AppError('INTERNAL', `Failed to delete credential for "${pattern}": ${(err as Error)?.message ?? String(err)}`, {
          cause: err,
        });
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
