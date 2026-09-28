import React from 'react';
import type { Session } from '@agy-studio/contracts';

export type CurrentSession = Session | null;

export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 shadow-xl text-center">
        <h1 className="text-2xl font-bold text-white mb-2">AGY Studio</h1>
        <p className="text-sm text-gray-400">模块 0.1 Monorepo 骨架与工具链</p>
      </div>
    </div>
  );
}

export default App;
