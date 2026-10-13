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

Monorepo（npm workspaces）。**每个顶层目录里都有 `README.md`**，在 GitHub 点进文件夹即可看说明。

| 路径 | 作用 |
|---|---|
| [`backend/`](backend/README.md) | Fastify 主服务 · spawn agy · 会话/账号/破甲刷新 |
| [`frontend/`](frontend/README.md) | React WebUI |
| [`contracts/`](contracts/README.md) | 前后端 API 类型（npm 包，非应用） |
| [`rules/`](rules/README.md) | 破甲源文件 → [`global/AGENTS.md`](rules/global/AGENTS.md) |
| [`scripts/`](scripts/README.md) | `setup-global-rules` 等 |
| [`gateway/`](gateway/README.md) | 可选 headless 网关 · `npm run gateway` |
| [`docs/`](docs/README.md) | 架构 / VERIFY / FAQ |
| [`tools/`](tools/README.md) | discover、fake-agy（开发） |
| [`e2e/`](e2e/README.md) | Playwright 测试 |
| [`fixtures/`](fixtures/README.md) | agy 录制样本（仅测试） |
| [`start.cmd`](start.cmd) | Windows 一键：依赖 → 破甲 → 构建 → 启 backend |
| [`brand.json`](brand.json) | 产品中英文名 |

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
