import React, { useEffect, useState } from 'react';
import type { UpdatePrefsBody } from '@agy-studio/contracts';
import { usePrefsStore } from '../stores/prefs.store';

/** Number settings: value range and what the user sees. */
export const NUMBER_SETTINGS = {
  stallTimeoutSeconds: { min: 30, max: 3600 },
  maxConcurrentRuns: { min: 1, max: 10 },
} as const;

type NumberKey = keyof typeof NUMBER_SETTINGS;

/** Parses a typed number and checks it against the setting's range; returns an error message on failure. */
export function parseSetting(key: NumberKey, raw: string): { value: number } | { error: string } {
  const { min, max } = NUMBER_SETTINGS[key];
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    return { error: `请输入 ${min} 到 ${max} 之间的整数` };
  }
  return { value };
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="mt-1 text-xs leading-5 text-text-tertiary">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberSetting({
  settingKey,
  value,
  unit,
  onSave,
}: {
  settingKey: NumberKey;
  value: number;
  unit: string;
  onSave: (patch: UpdatePrefsBody) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(String(value)), [value]);

  const commit = async () => {
    if (draft.trim() === String(value)) {
      setError(null);
      return;
    }
    const parsed = parseSetting(settingKey, draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    await onSave({ [settingKey]: parsed.value });
  };

  const { min, max } = NUMBER_SETTINGS[settingKey];
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          data-testid={`setting-${settingKey}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-24 rounded border border-border-default bg-bg-surface px-2 py-1 text-right font-mono text-sm text-text-primary focus:border-accent focus:outline-none"
        />
        <span className="text-xs text-text-tertiary">{unit}</span>
      </div>
      {error && <span className="text-[11px] text-status-error-text">{error}</span>}
    </div>
  );
}

export function SettingsView() {
  const hookPrefs = usePrefsStore((s) => s.prefs);
  // Server rendering (tests) gets the initial store state from the hook; fall back to the live state.
  const prefs = hookPrefs ?? usePrefsStore.getState().prefs;
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!usePrefsStore.getState().prefs) void usePrefsStore.getState().fetchPrefs();
  }, []);

  useEffect(() => {
    if (status?.kind !== 'saved') return;
    const timer = setTimeout(() => setStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  const save = async (patch: UpdatePrefsBody) => {
    try {
      await usePrefsStore.getState().updatePrefs(patch);
      setStatus({ kind: 'saved', text: '已保存' });
    } catch (err) {
      setStatus({ kind: 'error', text: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="settings-view">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-text-primary">设置</h2>
          {status && (
            <span
              data-testid="settings-status"
              className={`text-xs ${status.kind === 'saved' ? 'text-status-success-text' : 'text-status-error-text'}`}
            >
              {status.text}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-tertiary">修改后立即保存，下一次运行生效。主题在右上角切换。</p>

        {!prefs ? (
          <div className="mt-6 text-sm text-text-tertiary">加载中…</div>
        ) : (
          <div className="mt-4 rounded-lg border border-border-default bg-bg-surface px-5">
            <Row title="显示模型思考过程" hint="关闭后，对话里不再显示 Thinking 内容（工具调用与回复不受影响）。">
              <button
                type="button"
                role="switch"
                aria-checked={prefs.showThinking}
                data-testid="setting-showThinking"
                onClick={() => void save({ showThinking: !prefs.showThinking })}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  prefs.showThinking ? 'bg-accent' : 'bg-border-strong'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    prefs.showThinking ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </button>
            </Row>
            <Row
              title="卡住提醒时间"
              hint="运行中超过这么久没有任何新输出，就提示可能卡住了。正在执行命令时自动放宽到 3 倍。"
            >
              <NumberSetting settingKey="stallTimeoutSeconds" value={prefs.stallTimeoutSeconds} unit="秒" onSave={save} />
            </Row>
            <Row title="最多同时运行" hint="同时处于运行中的会话上限，超出时新任务会被拒绝。">
              <NumberSetting settingKey="maxConcurrentRuns" value={prefs.maxConcurrentRuns} unit="个会话" onSave={save} />
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}
