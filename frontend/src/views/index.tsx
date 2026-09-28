import React from 'react';

export function ManagerView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">会话主视图 (ManagerView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          时间线、思考块、工具调用卡片与底部输入框骨架
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-text-tertiary font-mono">
          <span>左侧收件箱</span>
          <span>•</span>
          <span>中央对话流</span>
          <span>•</span>
          <span>右侧 Artifacts</span>
        </div>
      </div>
    </div>
  );
}

export function AccountsView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">账号管理 (AccountsView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          展示隔离模式、账号列表、网页登录与凭据状态
        </p>
      </div>
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-text-primary">全局设置 (SettingsView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          自动同意规则、运行超时、模型默认参数与偏好配置
        </p>
      </div>
    </div>
  );
}

export function PlaygroundView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-secondary">
      <div className="max-w-md rounded-xl border border-dashed border-accent/40 bg-bg-surface p-6 shadow-lg">
        <div className="inline-flex rounded bg-accent-subtle px-2 py-0.5 text-xs font-mono text-accent">
          DEV ONLY
        </div>
        <h2 className="mt-2 text-lg font-semibold text-text-primary">组件游乐场 (PlaygroundView)</h2>
        <p className="mt-2 text-sm text-text-secondary">
          用于开发调试时间线原子组件、状态卡片与富文本渲染
        </p>
      </div>
    </div>
  );
}
