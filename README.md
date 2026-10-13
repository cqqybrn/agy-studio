# Antigravity Gemini 破甲

**Antigravity Gemini Armour Break**

本机 [Antigravity CLI (`agy`)](https://antigravity.google/docs) 的 Web 客户端：

| 能力 | 做什么 |
|---|---|
| **自动同意** | 跑任务时强制放行权限确认（不必手点 Always Proceed） |
| **破甲** | 安装全局规则到 `~/.gemini/config/AGENTS.md`，本机 agy / IDE / WebUI 共用 |

| | |
|---|---|
| 中文名 | Antigravity Gemini 破甲 |
| English | Antigravity Gemini Armour Break |
| 环境 | Windows 10/11 · Node ≥ 20 · 已安装并登录 `agy` |
| 界面产品名 | `frontend/src/branding.ts` |

GitHub 仓库名可能仍是 `agy-studio`，**产品名以上表为准**。

---

## 快速开始

```bash
git clone https://github.com/cqqybrn/agy-studio.git antigravity-gemini
cd antigravity-gemini
npm install          # 依赖 + 自动写入破甲规则
start.cmd            # Windows 推荐；或见下方手动启动
```

浏览器打开 **http://127.0.0.1:8790**。

手动启动（已有 `node_modules` 时）：

```bash
npm run setup-global-rules
npm run build -w frontend
npx tsx backend/src/main.ts
```

---

## 1. 自动同意（代码在 backend，不是规则文件）

WebUI / 网关在每次 run 前多层兜底，避免弹窗卡住：

| 层 | 行为 |
|---|---|
| L1 | spawn `agy` 时带 `--dangerously-skip-permissions` |
| L2 | 写入 / 校准 `settings.json`：`toolPermission: always-proceed` |
| L3 | 流里若仍出现权限确认事件，自动回填同意 |
| L4 | 无输出看门狗，防止假死挂起 |

实现入口：`backend/src/services/autoapprove/`。  
**这与下面的「破甲」是两件事**：自动同意管权限弹窗；破甲管模型常驻行为规则。

---

## 2. 破甲（全局规则，只有一份源）

| 项 | 路径 |
|---|---|
| **仓库内唯一正文** | [`rules/global/AGENTS.md`](rules/global/AGENTS.md) |
| 本机生效 | `%USERPROFILE%\.gemini\config\AGENTS.md` |
| 何时安装 | `npm install`（postinstall）、`start.cmd`、`npm run setup-global-rules`、后端启动与每次 run 前 |

说明见 [`rules/README.md`](rules/README.md)。不要去 `gateway/` 里找另一套破甲——网关共用根目录这份文件。

---

## 仓库怎么看

日常用 WebUI 只关心：**`start.cmd` · `backend/` · `frontend/` · `rules/`**。

根目录其它文件（`.npmrc`、`eslint`、`prettier`、`tsconfig.base.json` 等）是安装/开发用，可忽略。

| 路径 | 角色 |
|---|---|
| [`backend/`](backend/README.md) | 主服务：API、spawn agy、**自动同意**、破甲刷新 |
| [`frontend/`](frontend/README.md) | React WebUI |
| [`rules/`](rules/README.md) | **破甲**源文件（仅此一份） |
| [`scripts/`](scripts/README.md) | `setup-global-rules` |
| [`start.cmd`](start.cmd) | 一键：依赖 → 破甲 → 构建前端 → 启 backend |
| [`gateway/`](gateway/README.md) | **可选** headless HTTP/SSE（无 WebUI），共用 `rules/` |
| [`contracts/`](contracts/README.md) | 前后端 TypeScript 类型（不是应用） |
| [`docs/`](docs/README.md) | FAQ / 架构（内部长文） / VERIFY |
| [`tools/`](tools/README.md) · [`e2e/`](e2e/README.md) · [`fixtures/`](fixtures/README.md) | 开发与测试，日常可忽略 |

---

## 常用命令

```bash
npm run setup-global-rules   # 手动刷新本机破甲
npm run gateway              # 仅 headless 网关
npm run test                 # 全仓测试
```

---

## 安全

- 默认只监听 `127.0.0.1`。`HOST` 绑非回环时必须设 `AGY_STUDIO_TOKEN`，勿裸奔公网。
- 自动同意下 Agent 可直接改删工作区文件；无内置回滚，重要改动先 `git commit`。

---

## 文档

- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 端口 / agy / 代理 FAQ  
- [docs/VERIFY.md](docs/VERIFY.md) — agy 版本兼容记录  
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 内部架构长文（历史派工，以代码为准）

MIT License。
