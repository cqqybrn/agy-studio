# backend

WebUI **主服务**（必开）。

- spawn `agy`、会话 / 工作区 / 账号 / 额度  
- **自动同意**：`src/services/autoapprove/`  
- **破甲刷新**：`src/integrations/agy/global-rules.ts`（读根目录 `rules/global/AGENTS.md`）  
- 本地图片代理：`GET /api/local-media`（渲染 agent 的 `file://` 图）

入口：`src/main.ts`。通常用根目录 `start.cmd` 启动，不必单独进本目录。
