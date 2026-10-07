import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LanAccessStatus } from '@agy-studio/contracts';
import { getLanAccess, regenerateLanAccess, setLanAccess } from '../api/endpoints';

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (!svg) return null;
  return (
    <div
      data-testid="lan-qr"
      className="h-40 w-40 shrink-0 rounded-md bg-white p-2"
      // generated locally by the qrcode library from our own URL
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Settings → LAN access: let phones and other computers on the same network open AGY Studio. */
export function LanAccessSection({ initial = null }: { initial?: LanAccessStatus | null }) {
  const [status, setStatus] = useState<LanAccessStatus | null>(initial);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getLanAccess());
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (!initial) void refresh();
  }, [initial, refresh]);

  const run = async (action: () => Promise<LanAccessStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setSelected(0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('复制失败，请手动选中链接复制');
    }
  };

  if (!status) {
    return <div className="py-4 text-xs text-text-tertiary">{error ?? '加载中…'}</div>;
  }

  const active = status.enabled && status.listening;
  const current = status.addresses[Math.min(selected, status.addresses.length - 1)];

  return (
    <div className="py-4" data-testid="lan-access-section">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">局域网访问</div>
          <div className="mt-1 text-xs leading-5 text-text-tertiary">
            开启后，同一 Wi-Fi / 局域网里的手机、平板和其他电脑可以用下面的链接打开 AGY Studio。
          </div>
        </div>
        {status.canManage && (
          <button
            type="button"
            role="switch"
            aria-checked={status.enabled}
            data-testid="setting-lanAccess"
            disabled={busy}
            onClick={() => void run(() => setLanAccess(!status.enabled))}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              status.enabled ? 'bg-accent' : 'bg-border-strong'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                status.enabled ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        )}
      </div>

      {!status.available && (
        <div className="mt-3 rounded border border-border-default bg-bg-panel p-3 text-xs text-text-secondary">
          当前已通过环境变量 HOST / AGY_STUDIO_TOKEN 对局域网开放，这里不能修改。
        </div>
      )}

      {status.available && !status.canManage && (
        <div className="mt-3 rounded border border-border-default bg-bg-panel p-3 text-xs text-text-secondary">
          你正在通过局域网访问。只能在运行 AGY Studio 的那台电脑上修改这个设置。
        </div>
      )}

      {status.error && (
        <div className="mt-3 rounded border border-status-error/30 bg-status-error-subtle p-3 text-xs text-status-error-text">
          {status.error}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-status-error/30 bg-status-error-subtle p-3 text-xs text-status-error-text">
          {error}
        </div>
      )}

      {active && status.canManage && (
        <div className="mt-4 space-y-3">
          {status.addresses.length === 0 ? (
            <div className="text-xs text-text-tertiary">没有找到可用的局域网地址，请确认电脑已连上 Wi-Fi 或网线。</div>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row">
              {current && <QrCode text={current.url} />}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="text-xs text-text-tertiary">手机扫码，或在其他设备的浏览器里打开：</div>
                {status.addresses.map((a, i) => (
                  <div
                    key={a.url}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                      i === selected ? 'bg-bg-surface-active' : 'hover:bg-bg-surface-hover'
                    }`}
                  >
                    <button
                      type="button"
                      data-testid="lan-address"
                      onClick={() => setSelected(i)}
                      className="min-w-0 flex-1 text-left"
                      title="显示这个地址的二维码"
                    >
                      <span className="mr-2 text-text-tertiary">{a.name}</span>
                      <span className="font-mono text-text-primary">{a.address}:{status.port}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy(a.url)}
                      className="shrink-0 rounded border border-border-default px-2 py-0.5 text-text-secondary hover:text-text-primary"
                    >
                      {copied === a.url ? '已复制' : '复制链接'}
                    </button>
                  </div>
                ))}
                <div className="pt-1 text-[11px] leading-5 text-text-tertiary">
                  有多个地址时，选和手机在同一网络的那个（通常是 WLAN / 以太网）。
                </div>
              </div>
            </div>
          )}
          <div className="rounded border border-status-warning/40 bg-status-warning-subtle p-3 text-xs leading-5 text-status-warning-text">
            拿到这个链接的人可以让 agy 在这台电脑上执行任意操作（读写文件、运行命令），只在可信的家庭 / 办公网络开启，不要发给别人。
            第一次开启时 Windows 可能弹出防火墙提示，请选择「允许」（专用网络）。
          </div>
          <button
            type="button"
            data-testid="lan-regenerate"
            disabled={busy}
            onClick={() => {
              if (window.confirm('更换访问码后，之前发出的链接都会失效，已连接的设备需要重新扫码。继续吗？')) {
                void run(regenerateLanAccess);
              }
            }}
            className="rounded border border-border-default px-3 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            更换访问码
          </button>
        </div>
      )}
    </div>
  );
}
