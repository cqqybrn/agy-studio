import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LoginTerminal,
  defaultTerminalLauncher,
  type TerminalProcess,
  type TerminalLauncher,
} from '../../src/integrations/agy/login-terminal.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

describe('LoginTerminal Integration', () => {
  const fakeProfile: AgyProfile = {
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
      artifactRules: [],
    },
    settings: {
      files: [],
      alwaysProceed: { jsonPath: 'toolPermission', value: 'always-proceed' },
      statusline: { jsonPath: 'statusline' },
    },
    credentials: {
      preferredIsolation: 'credential_snapshot',
      homeEnvVars: [],
      wincredTargetPatterns: ['gemini:antigravity'],
      credentialFiles: [],
    },
    login: {
      argv: ['login', '--custom-flag'],
      authUrlPattern: 'https?://[^\\s]+',
      successPatterns: ['Logged in as'],
      failurePatterns: ['Authentication failed'],
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

  it('starts login with injected terminal launcher and returns valid LoginHandle', async () => {
    let launchedCommand = '';
    let launchedArgs: string[] = [];
    let launchedEnv: NodeJS.ProcessEnv | undefined;
    const killMock = vi.fn();

    const mockLauncher: TerminalLauncher = (command, args, options) => {
      launchedCommand = command;
      launchedArgs = args;
      launchedEnv = options?.env;
      return {
        pid: 12345,
        kill: killMock,
      };
    };

    const loginTerminal = new LoginTerminal({
      profile: fakeProfile,
      binaryPath: 'D:\\custom\\agy.exe',
      terminalLauncher: mockLauncher,
    });

    const handle = await loginTerminal.startLogin({
      accountName: 'test-account',
      env: { CUSTOM_LOGIN_VAR: '1' },
    });

    expect(handle.loginId).toMatch(/^login_/);
    expect(launchedCommand).toBe('D:\\custom\\agy.exe');
    expect(launchedArgs).toEqual(['login', '--custom-flag']);
    expect(launchedEnv?.CUSTOM_LOGIN_VAR).toBe('1');

    // Initial session check
    expect(handle.session).toEqual({
      loginId: handle.loginId,
      status: 'awaiting_browser',
      authUrl: null,
      email: null,
      error: null,
    });

    // waitForAuthUrl returns empty string
    const authUrl = await handle.waitForAuthUrl();
    expect(authUrl).toBe('');

    // Cancel closes terminal and resolves completion
    const completionPromise = handle.waitForCompletion();
    await handle.cancel();

    expect(killMock).toHaveBeenCalledOnce();
    expect(handle.session.status).toBe('cancelled');

    const completedSession = await completionPromise;
    expect(completedSession.status).toBe('cancelled');

    // Repeated cancel is a no-op
    await handle.cancel();
    expect(killMock).toHaveBeenCalledOnce();
  });

  it('supports open() alias as well as startLogin()', async () => {
    const mockLauncher: TerminalLauncher = () => ({
      pid: 54321,
      kill: vi.fn(),
    });

    const loginTerminal = new LoginTerminal({
      profile: fakeProfile,
      terminalLauncher: mockLauncher,
    });

    const handle = await loginTerminal.open({
      accountName: 'alias-account',
    });

    expect(handle.loginId).toBeDefined();
    expect(handle.session.status).toBe('awaiting_browser');
  });

  it('handles timeout when timeoutMs is exceeded', async () => {
    const killMock = vi.fn();
    const mockLauncher: TerminalLauncher = () => ({
      pid: 99999,
      kill: killMock,
    });

    const loginTerminal = new LoginTerminal({
      profile: fakeProfile,
      terminalLauncher: mockLauncher,
    });

    const handle = await loginTerminal.startLogin({
      accountName: 'timeout-account',
      timeoutMs: 50,
    });

    const completion = await handle.waitForCompletion();
    expect(completion.status).toBe('failed');
    expect(completion.error).toBe('Login timed out');
    expect(killMock).toHaveBeenCalled();
  });

  it('allows manually resolving completion with complete()', async () => {
    const mockLauncher: TerminalLauncher = () => ({
      pid: 11111,
      kill: vi.fn(),
    });

    const loginTerminal = new LoginTerminal({
      profile: fakeProfile,
      terminalLauncher: mockLauncher,
    });

    const handle = await loginTerminal.startLogin({
      accountName: 'complete-account',
    });

    handle.complete({
      loginId: handle.loginId,
      status: 'completed',
      authUrl: null,
      email: 'user@example.com',
      error: null,
    });

    const result = await handle.waitForCompletion();
    expect(result.status).toBe('completed');
    expect(result.email).toBe('user@example.com');
  });

  it('defaultTerminalLauncher spawns process without crashing on win32', async () => {
    const proc = await defaultTerminalLauncher('node', ['-e', 'process.exit(0)']);
    expect(proc).toBeDefined();
    if (proc.pid) {
      expect(typeof proc.pid).toBe('number');
    }
    // Calling kill does not throw
    expect(() => proc.kill()).not.toThrow();
  });
});
