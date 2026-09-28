import { describe, expect, it } from 'vitest';
import type {
  AgyRunnerPort,
  BrainPort,
  SettingsPort,
  CredentialPort,
  HomeIsolationPort,
  LoginPort,
  QuotaProbePort,
  StatuslineParserPort,
  ModelCatalogPort,
} from '../../src/services/ports/index.js';

describe('Service Ports Type Integrity', () => {
  it('allows port interfaces to be implemented without errors', () => {
    const mockRunner: AgyRunnerPort = {
      start: async () => ({
        pid: 1234,
        events: (async function* () {})(),
        send: async () => {},
        closeInput: () => {},
        kill: async () => {},
        exited: Promise.resolve({ exitCode: 0, signal: null }),
      }),
    };
    expect(mockRunner).toBeDefined();

    const mockBrain: BrainPort = {
      listConversations: async () => [],
      tailTranscript: async () => ({
        steps: (async function* () {})(),
        stop: () => {},
      }),
      listArtifacts: async () => [],
      watchArtifacts: async () => ({ stop: () => {} }),
      purgeConversation: async () => {},
    };
    expect(mockBrain).toBeDefined();

    const mockSettings: SettingsPort = {
      ensureAlwaysProceed: async () => ({ updated: true, filePath: 'test' }),
      installStatusline: async () => {},
      uninstallStatusline: async () => {},
    };
    expect(mockSettings).toBeDefined();

    const mockCredential: CredentialPort = {
      isPresent: async () => false,
      snapshot: async () => ({ version: 1, createdAt: '', targets: {}, files: {} }),
      restore: async () => {},
      clear: async () => {},
    };
    expect(mockCredential).toBeDefined();

    const mockHomeIsolation: HomeIsolationPort = {
      createHome: async (name) => `/path/to/${name}`,
      envFor: async (name) => ({ USERPROFILE: `/path/to/${name}` }),
      getHomePath: (name) => `/path/to/${name}`,
    };
    expect(mockHomeIsolation).toBeDefined();

    const mockLogin: LoginPort = {
      startLogin: async () => ({
        loginId: 'log-1',
        session: {
          loginId: 'log-1',
          status: 'pending',
          authUrl: null,
          email: null,
          error: null,
        },
        waitForAuthUrl: async () => 'https://auth.example.com',
        waitForCompletion: async () => ({
          loginId: 'log-1',
          status: 'completed',
          authUrl: null,
          email: 'test@example.com',
          error: null,
        }),
        cancel: async () => {},
      }),
    };
    expect(mockLogin).toBeDefined();

    const mockQuotaProbe: QuotaProbePort = {
      probe: async (acc) => ({
        source: 'cli_probe',
        accountName: acc,
        email: null,
        planTier: 'pro',
        title: 'Quota',
        description: null,
        groups: [],
        credits: { available: true, balance: 10 },
        fetchedAt: new Date().toISOString(),
        cached: false,
        stale: false,
      }),
    };
    expect(mockQuotaProbe).toBeDefined();

    const mockStatuslineParser: StatuslineParserPort = {
      parse: () => ({
        email: 'user@example.com',
        planTier: 'pro',
        groups: [],
      }),
    };
    expect(mockStatuslineParser).toBeDefined();

    const mockModelCatalog: ModelCatalogPort = {
      listModels: async () => [],
      getVersion: async () => '1.2.12',
      listModes: async () => ['plan'],
    };
    expect(mockModelCatalog).toBeDefined();
  });
});
