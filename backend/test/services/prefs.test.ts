import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, PrefsRepository } from '../../src/repositories/index.js';
import { PrefsService } from '../../src/services/prefs.js';

describe('PrefsService', () => {
  let db: Database.Database;
  let prefsRepo: PrefsRepository;
  let prefsService: PrefsService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    prefsRepo = new PrefsRepository(db);
    prefsService = new PrefsService({ prefsRepo });
  });

  afterEach(() => {
    db.close();
  });

  it('getPrefs returns expected default preference values', async () => {
    const prefs = await prefsService.getPrefs();

    expect(prefs).toEqual({
      showThinking: true,
      checkpointsEnabled: true,
      maxConcurrentRuns: 3,
      stallTimeoutSeconds: 180,
      defaultModel: null,
      defaultEffort: null,
      defaultMode: null,
      defaultWorkspaceId: null,
    });
  });

  it('updatePrefs updates partial values and persists them', async () => {
    const updated = await prefsService.updatePrefs({
      defaultModel: 'gemini-3.8-flash-high',
      defaultEffort: 'high',
      showThinking: false,
    });

    expect(updated.defaultModel).toBe('gemini-3.8-flash-high');
    expect(updated.defaultEffort).toBe('high');
    expect(updated.showThinking).toBe(false);
    expect(updated.checkpointsEnabled).toBe(true);
    expect(updated.maxConcurrentRuns).toBe(3);
    expect(updated.stallTimeoutSeconds).toBe(180);

    // 再次调用 getPrefs 确认持久化
    const persisted = await prefsService.getPrefs();
    expect(persisted).toEqual(updated);
  });

  it('updatePrefs supports setting null and updating other fields incrementally', async () => {
    await prefsService.updatePrefs({
      defaultModel: 'claude-sonnet-4-6',
      defaultWorkspaceId: 'ws-123',
      maxConcurrentRuns: 5,
    });

    const secondUpdate = await prefsService.updatePrefs({
      defaultModel: null,
      stallTimeoutSeconds: 300,
    });

    expect(secondUpdate.defaultModel).toBeNull();
    expect(secondUpdate.defaultWorkspaceId).toBe('ws-123');
    expect(secondUpdate.maxConcurrentRuns).toBe(5);
    expect(secondUpdate.stallTimeoutSeconds).toBe(300);
  });
});
