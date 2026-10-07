import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { LanAccessStatus } from '@agy-studio/contracts';
import { captureTokenFromUrl, TOKEN_STORAGE_KEY } from '../api/http';
import { LanAccessSection } from './LanAccessSection';

const base: LanAccessStatus = {
  available: true,
  enabled: true,
  listening: true,
  error: null,
  port: 8790,
  addresses: [
    { name: 'WLAN', address: '192.168.1.20', url: 'http://192.168.1.20:8790/?token=abc' },
    { name: 'VMware Network Adapter', address: '192.168.126.1', url: 'http://192.168.126.1:8790/?token=abc' },
  ],
  canManage: true,
};

describe('LanAccessSection', () => {
  it('on this computer: switch, every address with a copy button and the warning', () => {
    const html = renderToStaticMarkup(<LanAccessSection initial={base} />);
    expect(html).toContain('局域网访问');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('192.168.1.20:8790');
    expect(html).toContain('192.168.126.1:8790');
    expect(html.match(/复制链接/g)).toHaveLength(2);
    expect(html).toContain('防火墙');
    expect(html).toContain('data-testid="lan-regenerate"');
  });

  it('when off: only the switch', () => {
    const html = renderToStaticMarkup(<LanAccessSection initial={{ ...base, enabled: false, listening: false }} />);
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('复制链接');
  });

  it('from a LAN device: read-only, no switch', () => {
    const html = renderToStaticMarkup(<LanAccessSection initial={{ ...base, canManage: false }} />);
    expect(html).not.toContain('data-testid="setting-lanAccess"');
    expect(html).toContain('你正在通过局域网访问');
    expect(html).not.toContain('复制链接');
  });

  it('shows why the port could not open', () => {
    const html = renderToStaticMarkup(
      <LanAccessSection initial={{ ...base, listening: false, error: '无法在局域网端口 8790 上监听：EADDRINUSE' }} />,
    );
    expect(html).toContain('EADDRINUSE');
  });
});

describe('captureTokenFromUrl', () => {
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => {
    delete g.window;
  });

  function fakeWindow(href: string) {
    const store = new Map<string, string>();
    const replaced: string[] = [];
    g.window = {
      location: { href },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      history: { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
    };
    return { store, replaced };
  }

  it('keeps the access code from a LAN link and removes it from the address bar', () => {
    const { store, replaced } = fakeWindow('http://192.168.1.20:8790/?token=s3cret&x=1#/settings');
    expect(captureTokenFromUrl()).toBe(true);
    expect(store.get(TOKEN_STORAGE_KEY)).toBe('s3cret');
    expect(replaced).toEqual(['/?x=1#/settings']);
  });

  it('does nothing without a code', () => {
    const { store, replaced } = fakeWindow('http://127.0.0.1:8790/#/');
    expect(captureTokenFromUrl()).toBe(false);
    expect(store.size).toBe(0);
    expect(replaced).toEqual([]);
  });
});
