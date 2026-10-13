# gateway

**可选 headless 网关** — HTTP/SSE + 自动同意，无 React WebUI；与 WebUI 共用根目录 `rules/global/AGENTS.md`。

```bash
# 在仓库根目录
npm run gateway
# 或
npm start -w @antigravity-gemini/gateway
```

全局规则与 WebUI 共用根目录 `rules/global/AGENTS.md`；`npm install` 在根目录执行即可，无需单独 postinstall。
