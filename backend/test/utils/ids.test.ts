import { describe, expect, it } from 'vitest';
import { createId, isUuid } from '../../src/utils/ids.js';

describe('utils/ids', () => {
  it('creates valid standard UUIDs without prefix', () => {
    const id = createId();
    expect(isUuid(id)).toBe(true);
  });

  it('creates prefixed IDs', () => {
    const id = createId('sess');
    expect(id.startsWith('sess_')).toBe(true);
    const uuidPart = id.slice(5);
    expect(isUuid(uuidPart)).toBe(true);
  });

  it('rejects invalid UUID strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('12345')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
