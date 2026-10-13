# 常见问题

## Q1: `start.cmd` 提示端口被占用

默认端口 `8790`。可换端口：

```cmd
set PORT=9000
start.cmd
```

## Q2: 未检测到 agy CLI

1. 确认已安装 [Antigravity CLI](https://antigravity.google/docs) 且终端能运行 `agy --version`。
2. 未在 PATH 时：

```cmd
set AGY_BIN=D:\path\to\agy.exe
start.cmd
```

## Q3: 额度不可用 / 超时

- 检查网络与 Google 认证域名；代理见 Q5。
- 账号过期时在界面重新登录。

## Q4: contracts / 模块找不到

在**仓库根目录**执行 `npm install`（npm workspaces monorepo）。

## Q5: 登录连不上 Google / 转圈

`agy` 只认 `HTTPS_PROXY` / `HTTP_PROXY`，不读浏览器系统代理。

- 启动日志出现 `Using the Windows system proxy` 表示已自动沿用系统 HTTP 代理。
- PAC / 纯 SOCKS 需手动设置 HTTP 代理后启动。
- 强制直连：`set AGY_STUDIO_PROXY=off`
- 跳过预检：`set AGY_STUDIO_SKIP_NET_CHECK=1`
- agy 日志：`%USERPROFILE%\.gemini\antigravity-cli\log\`

## Q6: User location is not supported for the API use

出口 IP 地区不在 Gemini API 支持范围；换节点后重启 WebUI。

## Q7: npm install 报 node-gyp / Visual Studio

确认根目录 `.npmrc` 存在（`ignore-scripts=true`），或 `npm install --ignore-scripts`。

## Q8: 编辑重问很慢或失败

依赖隐藏 agy 交互执行 `/rewind`，通常 20–60 秒。失败时界面不删记录，可重试或新开会话。
