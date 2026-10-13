# Antigravity Gemini 破甲

**Antigravity Gemini Armour Break** — 本机 `agy` 的 Web 客户端，内置全局规则（破甲）。

| | |
|---|---|
| 中文名 | Antigravity Gemini 破甲 |
| English | Antigravity Gemini Armour Break |
| 要求 | Windows 10/11 · Node ≥ 20 · 已安装并登录 `agy` |

---

## 快速开始

```bash
git clone https://github.com/cqqybrn/agy-studio.git
cd agy-studio
npm install          # postinstall 自动破甲，见下
start.cmd            # 或: npm run build -w frontend && npx tsx backend/src/main.ts
```

浏览器打开 **http://127.0.0.1:8790**。

---

## 破甲（全局规则）

| 项 | 说明 |
|---|---|
| 仓库内源文件 | [`rules/global/AGENTS.md`](rules/global/AGENTS.md) |
| 安装目标 | `%USERPROFILE%\.gemini\config\AGENTS.md` |
| 何时写入 | `npm install`（postinstall）、`start.cmd`、`npm run setup-global-rules`、后端启动与每次 run 前 |

本机 **agy / IDE / WebUI** 共用该 Global Rule，无需再手贴 IDE 规则。产品名常量见 [`brand.json`](brand.json)。

---

## 仓库结构

Monorepo（npm workspaces）。日常只用根目录的 `start.cmd` 或 `backend` + `frontend`；其余目录多为类型、测试或可选组件。

| 路径 | 作用 |
|---|---|
| [`backend/`](backend/) | **主服务**：Fastify API/WebSocket、spawn `agy`、会话与工作区、账号/额度、四层自动同意、刷新 global rule |
| [`frontend/`](frontend/) | **WebUI**（React）：对话、思考流、子 Agent、设置与局域网访问 |
| [`contracts/`](contracts/) | 前后端共享的 API / 事件 TypeScript 类型（非独立应用） |
| [`rules/global/`](rules/global/) | **破甲规则**正文与说明 |
| [`scripts/`](scripts/) | `setup-global-rules.ts` 等安装脚本 |
| [`gateway/`](gateway/) | **可选**：无 WebUI 的 HTTP/SSE 网关 → 根目录 `npm run gateway` |
| [`start.cmd`](start.cmd) | Windows：检查 Node/agy → `npm install` → 装规则 → 构建前端 → 启 backend |
| [`tools/`](tools/) | 开发用：`discover`（探测 agy）、`fake-agy`（测试回放）等 |
| [`docs/`](docs/) | 架构与验证：`ARCHITECTURE.md`、`VERIFY.md`、[`TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| [`e2e/`](e2e/) | Playwright 端到端测试 |
| [`fixtures/agy/`](fixtures/agy/) | 录制的 agy 输出样本（单元测试/fixtures，非运行时数据） |

根目录 [`package.json`](package.json)：`setup-global-rules`、`postinstall`、`gateway` 等脚本入口。

---

## 常用命令

```bash
npm run setup-global-rules   # 手动刷新 ~/.gemini/config/AGENTS.md
npm run dev                  # 各 workspace 开发模式（若已配置）
npm run test                 # 全仓测试
npm run gateway              # 仅 headless 网关（见 gateway/README.md）
```

---

## 安全提示

- 默认只监听 `127.0.0.1`；开启局域网访问后，持有链接+访问码者≈本机 shell 权限。勿裸奔公网。
- 无内置工作区回滚；重要改动请先 `git commit`。自动同意下 Agent 可直接改删文件。

---

## 文档

- 架构与模块划分：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- agy 版本兼容记录：[docs/VERIFY.md](docs/VERIFY.md)
- 故障排查：[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

MIT License。
