import { describe, expect, it } from 'vitest';
import type { Model } from '@agy-studio/contracts';
import { mergeSupplementalModels, SUPPLEMENTAL_MODELS } from '../../src/services/supplemental-models.js';

describe('mergeSupplementalModels', () => {
  it('prepends Argon variants when CLI catalog lacks them', () => {
    const live: Model[] = [
      {
        id: 'gemini-3.8-flash-high',
        label: 'Gemini 3.8 Flash (High)',
        group: 'gemini',
        isDefault: false,
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6 (Thinking)',
        group: 'third_party',
        isDefault: false,
      },
    ];
    const merged = mergeSupplementalModels(live);
    expect(merged.map((m) => m.id).slice(0, 3)).toEqual([
      'gemini-4-argon-high',
      'gemini-4-argon-medium',
      'gemini-4-argon-low',
    ]);
    expect(merged.some((m) => m.id === 'gemini-3.8-flash-high')).toBe(true);
    expect(merged.at(-1)?.id).toBe('claude-sonnet-4-6');
  });

  it('does not duplicate ids already returned by CLI', () => {
    const live: Model[] = [...SUPPLEMENTAL_MODELS];
    const merged = mergeSupplementalModels(live);
    const ids = merged.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('gemini-4-argon')).length).toBe(3);
  });
});
