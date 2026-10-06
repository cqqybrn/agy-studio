import { describe, expect, it } from 'vitest';
import { DirectoryBrowser } from '../../src/services/directory-browser.js';

describe('DirectoryBrowser', () => {
  it('lists drives at the top level on Windows', async () => {
    const browser = new DirectoryBrowser({ platform: 'win32', listDrives: () => ['C:\\', 'D:\\'] });
    expect(await browser.list()).toEqual({
      path: null,
      parent: null,
      entries: [
        { name: 'C:', path: 'C:\\' },
        { name: 'D:', path: 'D:\\' },
      ],
    });
  });

  it('goes back to the drive list from a drive root and hides system folders', async () => {
    if (process.platform !== 'win32') return;
    const listing = await new DirectoryBrowser().list('C:\\');
    expect(listing.path).toBe('C:\\');
    expect(listing.parent).toBeNull();
    expect(listing.entries.some((e) => e.name.toLowerCase() === '$recycle.bin')).toBe(false);
  });
});
