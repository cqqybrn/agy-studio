# Headless 网关（可选）

**Antigravity Gemini 破甲 · Antigravity Gemini Armour Break**

无 WebUI 时可用本目录的 HTTP/SSE 网关（原独立仓库已并入 monorepo）。

```bash
# 在仓库根目录
npm run gateway
# 或
npm start -w @antigravity-gemini/gateway
```

全局规则与 WebUI 共用根目录 `rules/global/AGENTS.md`；`npm install` 在根目录执行即可，无需单独 postinstall。
