import type { Model } from '@agy-studio/contracts';

/**
 * Models that the Studio UI should surface even when the live `agy models`
 * catalog has not listed them yet (rollout / plan gating).
 *
 * Gemini 4 Argon: Google AI Ultra / Enterprise; CLI IDs match desktop app 2.23+.
 * When the account/CLI finally offers them, the live row wins (same id).
 */
export const SUPPLEMENTAL_MODELS: Model[] = [
  {
    id: 'gemini-4-argon-high',
    label: 'Gemini 4 Argon (High)',
    group: 'gemini',
    isDefault: false,
  },
  {
    id: 'gemini-4-argon-medium',
    label: 'Gemini 4 Argon (Medium)',
    group: 'gemini',
    isDefault: false,
  },
  {
    id: 'gemini-4-argon-low',
    label: 'Gemini 4 Argon (Low)',
    group: 'gemini',
    isDefault: false,
  },
];

/** Merge supplemental models; live catalog entries keep precedence on id clash. */
export function mergeSupplementalModels(live: Model[]): Model[] {
  const seen = new Set(live.map((m) => m.id));
  const extras = SUPPLEMENTAL_MODELS.filter((m) => !seen.has(m.id));
  if (extras.length === 0) return live;

  // Keep gemini block first: extras (Argon) then live gemini, then third_party.
  const liveGemini = live.filter((m) => m.group === 'gemini');
  const liveOther = live.filter((m) => m.group !== 'gemini');
  return [...extras, ...liveGemini, ...liveOther];
}
