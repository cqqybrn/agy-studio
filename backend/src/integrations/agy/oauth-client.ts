import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AgyProfile } from './profile/schema.js';

export interface OAuthClientCandidates {
  clientId: string;
  clientSecrets: string[];
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function extractOAuthCandidatesFromText(
  latin1Text: string,
  aud?: string | null,
): OAuthClientCandidates | null {
  const ids: string[] = [];
  const idSet = new Set<string>();
  const idRegex = /[0-9]+-[0-9a-z_.-]+\.apps\.googleusercontent\.com/gi;
  for (const match of latin1Text.matchAll(idRegex)) {
    const id = match[0];
    if (!idSet.has(id)) {
      idSet.add(id);
      ids.push(id);
    }
  }

  const secrets: string[] = [];
  const secretSet = new Set<string>();
  // Google OAuth client secrets start with GOCSPX- followed by 28 alphanumeric/dash/underscore characters (total 35 chars)
  const secretRegex = /GOCSPX-[A-Za-z0-9_-]{28}/g;
  for (const match of latin1Text.matchAll(secretRegex)) {
    const s = match[0];
    if (!secretSet.has(s)) {
      secretSet.add(s);
      secrets.push(s);
    }
  }

  if (ids.length === 0 || secrets.length === 0) {
    return null;
  }

  let selectedId: string | null = null;
  if (aud && ids.includes(aud)) {
    selectedId = aud;
  } else if (!aud && ids.length === 1) {
    selectedId = ids[0];
  } else if (aud) {
    return null;
  } else {
    return null;
  }

  return {
    clientId: selectedId,
    clientSecrets: secrets,
  };
}

export function findAgyBinaryPath(profile?: AgyProfile, explicitPath?: string): string | null {
  if (explicitPath) {
    return fs.existsSync(explicitPath) ? path.resolve(explicitPath) : null;
  }

  if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) {
    return path.resolve(process.env.AGY_BIN);
  }

  if (profile?.binary?.candidates) {
    for (const candidate of profile.binary.candidates) {
      let expanded = candidate;
      if (process.platform === 'win32') {
        expanded = candidate.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
      }
      if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
        if (fs.existsSync(expanded)) {
          return path.resolve(expanded);
        }
      } else {
        try {
          const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [expanded], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: true,
          });
          if (probe.status === 0 && probe.stdout) {
            const firstLine = probe.stdout.split(/\r?\n/)[0]?.trim();
            if (firstLine && fs.existsSync(firstLine)) {
              return path.resolve(firstLine);
            }
          }
        } catch {
          // Ignored
        }
      }
    }
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const defaultAgy = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (fs.existsSync(defaultAgy)) {
        return path.resolve(defaultAgy);
      }
    }
  }

  return null;
}

export interface OAuthClientOptions {
  profile?: AgyProfile;
  binaryPath?: string;
  readBinary?: (filePath: string) => Buffer | string;
  scanner?: (text: string, aud?: string | null) => OAuthClientCandidates | null;
}

export class OAuthClientManager {
  private readonly confirmedPairs = new Map<string, string>();
  private readonly failedSecrets = new Map<string, Set<string>>();

  constructor(private readonly options: OAuthClientOptions = {}) {}

  clear(): void {
    this.confirmedPairs.clear();
    this.failedSecrets.clear();
  }

  getCandidates(aud?: string | null): OAuthClientCandidates | null {
    try {
      if (process.env.AGY_OAUTH_CLIENT_ID && process.env.AGY_OAUTH_CLIENT_SECRET) {
        const envId = process.env.AGY_OAUTH_CLIENT_ID;
        const envSecret = process.env.AGY_OAUTH_CLIENT_SECRET;
        if (!aud || aud === envId) {
          return { clientId: envId, clientSecrets: [envSecret] };
        }
      }

      const binPath = this.options.binaryPath ?? findAgyBinaryPath(this.options.profile);
      if (!binPath) {
        return null;
      }

      let text: string;
      if (this.options.readBinary) {
        const raw = this.options.readBinary(binPath);
        text = typeof raw === 'string' ? raw : raw.toString('latin1');
      } else {
        if (!fs.existsSync(binPath)) {
          return null;
        }
        text = fs.readFileSync(binPath).toString('latin1');
      }

      const scanner = this.options.scanner ?? extractOAuthCandidatesFromText;
      return scanner(text, aud);
    } catch {
      return null;
    }
  }

  getClientCredentials(aud?: string | null): OAuthCredentials | null {
    if (aud && this.confirmedPairs.has(aud)) {
      return {
        clientId: aud,
        clientSecret: this.confirmedPairs.get(aud)!,
      };
    }

    const candidates = this.getCandidates(aud);
    if (!candidates) {
      return null;
    }

    const { clientId, clientSecrets } = candidates;

    if (this.confirmedPairs.has(clientId)) {
      return {
        clientId,
        clientSecret: this.confirmedPairs.get(clientId)!,
      };
    }

    const failed = this.failedSecrets.get(clientId) ?? new Set<string>();
    const nextSecret = clientSecrets.find((s) => !failed.has(s));
    if (!nextSecret) {
      return null;
    }

    return {
      clientId,
      clientSecret: nextSecret,
    };
  }

  rememberSuccess(clientId: string, clientSecret: string): void {
    this.confirmedPairs.set(clientId, clientSecret);
  }

  markSecretInvalid(clientId: string, clientSecret: string): void {
    if (this.confirmedPairs.get(clientId) === clientSecret) {
      this.confirmedPairs.delete(clientId);
    }
    let failed = this.failedSecrets.get(clientId);
    if (!failed) {
      failed = new Set();
      this.failedSecrets.set(clientId, failed);
    }
    failed.add(clientSecret);
  }
}
