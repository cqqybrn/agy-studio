# agy-profile.json 字段说明与降级策略

本文档说明 `backend/agy-profile.json` 中各个字段的补全来源、实测依据及无法完全确定的字段所采用的降级方案（依据 `docs/ARCHITECTURE.md` 与 `docs/VERIFY.md`）。

---

## 1. 基础信息 (`agyVersion`, `discoveredAt`, `binary`)
- **agyVersion**: `1.2.12`，源自探测阶段与 `simple-chat` fixture 记录。
- **discoveredAt**: `2026-09-28T00:00:00.000Z`。
- **binary.candidates**:
  - `agy`, `agy.exe`：环境变量 PATH 候选。
  - `%LOCALAPPDATA%\agy\bin\agy.exe`：Windows 默认用户目录安装路径。

---

## 2. 流交互配置 (`stream`)
- **userFrameTemplate**:
  - 实测依据：`docs/VERIFY.md` V1 证实标准 user 帧为 `{"event":"user","message":{"content":"..."}}`。
  - 模板采用占位符形式：`{"event":"user","message":{"content":"{{prompt}}"}}`。
- **multiTurnStdin**:
  - `true`：`docs/VERIFY.md` V1 明确证实 stream-json 进程支持连续多轮 stdin 输入，在每轮发出 `result` 事件后继续监听。
- **eventTypeMap**:
  - 映射 `init`, `step_update`, `result` 事件。
- **permissionEvent**:
  - `match`: `{"event": "ask_permission"}`
  - `replyTemplate`: `{"event":"permission_response","allow":true}`
  - 依据：`docs/VERIFY.md` V2，开启 skip-permissions 下常规工具无需确认，但遇到跨工作区/敏感操作可能出现 `ask_permission`，四层兜底 L3 自动回复该模板。
- **imageInput**:
  - `supported`: `false`
  - `template`: `null`
  - 依据：`docs/VERIFY.md` V4 证实当前 agy CLI 原生不支持 image content block，系统采用路径注入降级。

---

## 3. 路径配置 (`paths`)
- **dataRoots**:
  - `["%USERPROFILE%\\.antigravity", "%LOCALAPPDATA%\\agy"]`。
- **conversationDirPattern**:
  - `%USERPROFILE%\\.antigravity\\conversations\\{{conversationId}}`。
  - 降级依据：V5 待模块 0.3 深度探测，按 Antigravity 官方用户目录约定与降级方案采用 `conversations/{{conversationId}}` 目录结构。
- **transcriptRelPath**:
  - `transcript.jsonl`：会话主推理与 step 记录文件。
- ~~**artifactRules**~~：已随 Artifacts 面板一起删除（2026-10-04）。

---

## 4. 设置配置 (`settings`)
- **files**:
  - `user`: `%USERPROFILE%\\.antigravity\\settings.json`
  - `workspace`: `{{workspacePath}}\\.antigravity\\settings.json`
- **alwaysProceed**:
  - `jsonPath`: `security.alwaysProceed`
  - `value`: `true`
  - 降级依据：V6 深度比对前，按 Antigravity 官方配置结构填写降级默认路径。
- **statusline**:
  - `jsonPath`: `statusline`

---

## 5. 凭据配置 (`credentials`)
- **preferredIsolation**:
  - `isolated_home`：优先模式，配合环境变量覆盖。
- **homeEnvVars**:
  - `["USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA"]`
- **wincredTargetPatterns**:
  - `["gemini:antigravity"]`：Windows 凭据管理器通用条目的真实 TargetName（UserName 为 `antigravity`，数据为 UTF-8 JSON）。`cmdkey /list` 显示的 `LegacyGeneric:target=` 前缀不属于 TargetName。依据 VERIFY.md V7 实录。
- **credentialFiles**:
  - `[]`：agy 不使用凭据文件。`~/.gemini/oauth_creds.json` 属于其他程序，不得纳入快照（VERIFY.md V7）。

---

## 6. 登录配置 (`login`)
- **argv**: `["login"]`
- **authUrlPattern**: `https?://[^\s]+`：从伪终端文本流匹配授权 URL。
- **successPatterns**: `["Logged in as", "Authentication successful", "Welcome"]`
- **failurePatterns**: `["Authentication failed", "Login cancelled", "Error: "]`

---

## 7. 额度配置 (`quota`)
- **statuslineInHeadless**: `false`（无界面 stream-json 默认不主动回调 statusline，依赖 `/usage` 探针）。
- **usageCommand**: `/usage`
- **creditsCommand**: `/credits`
- **usageParser**: `text-v1`

---

## 8. 模型与目录 (`catalog`)
- **versionArgv**: `["--version"]`
- **modelsArgv**: `["models"]`
- **modelsParser**: `text-v1`
- **modes**: `["accept-edits", "plan"]`
