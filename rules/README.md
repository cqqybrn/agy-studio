# rules — 破甲（唯一源）

全局规则正文只在这一处维护，不要在 `gateway/` 或别处复制第二份。

| | |
|---|---|
| 正文 | [`global/AGENTS.md`](global/AGENTS.md) |
| 安装到本机 | `%USERPROFILE%\.gemini\config\AGENTS.md` |
| 安装命令 | 仓库根目录 `npm run setup-global-rules`（`npm install` / `start.cmd` 也会跑） |

与 **自动同意** 的区别：自动同意在 `backend/src/services/autoapprove/`（权限弹窗）；本目录只管模型 Global Rule 文本。

改完规则后：

```bash
npm run setup-global-rules
```

然后**新开** agy / WebUI 会话才会读到新内容。
