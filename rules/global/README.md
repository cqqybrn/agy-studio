# Antigravity 破甲 · 全局规则

与 [antigravity-pojia](https://github.com/cqqybrn/antigravity-pojia) **同一份** `AGENTS.md`（请两边仓库保持同步）。

| 角色 | 路径 |
| --- | --- |
| Git 源 | `rules/global/AGENTS.md`（本目录） |
| 本机生效 | `%USERPROFILE%\.gemini\config\AGENTS.md` |

**AGY Studio** 在 `npm install` / 启动 / 每次 run 前会通过 `backend/src/integrations/agy/global-rules.ts` 安装到上述 config 路径，本机 **所有 agy 会话**（含 Studio 里 spawn 的 agy）都会加载。

```powershell
npm run setup-global-rules
```
