# AGY Studio · 架构设计与分块派工（v2 · 零移植版）

> 一个复刻 Antigravity Agent 界面的本地 WebUI：底层直接调用本机 `agy` CLI，敏感操作**全部自动同意**，
> 可以看思考过程、子 agent、额度，并切换账号。
>
> 本文档按 `cursor-architect-copilot` 的六阶段流程编写。契约的唯一真相源是 `contracts/src/*.ts`，文档与代码冲突时以代码为准。
>
> **2026-10-04 变更：移除 Artifacts 面板与检查点（影子 git）。** 按产品决定整体删除：右侧面板（Task / Plan / Walkthrough / Media / Changes）、`services/artifact.ts`、`services/checkpoint.ts` 及其路由与仓库、`Artifact` / `Checkpoint` 类型、`artifact.updated` 事件、`CHECKPOINT_FAILED` 错误码、`Prefs.checkpointsEnabled`、`Run.checkpointId`、profile 的 `artifactRules`。界面由三栏改为两栏。子 agent transcript 接口保留，迁到 `services/subagent-transcript.ts` 与 `routes/http/subagents.routes.ts`。数据库新增第 2 版迁移 `drop_checkpoints`（删 `checkpoints` 表、`runs.checkpoint_id` 列、`checkpointsEnabled` 偏好）。不再内置回滚，README 要求用户发起任务前自行用 git 提交。下文模块 1.10、1.12、2.10、2.12 及其派工单只作历史记录。
>
> **2026-10-04 新增：编辑重问。** 用户可编辑已发送的消息：agy 的对话回退到该消息之前（agy 同时还原那些轮次里的文件改动），Studio 删除该消息起的全部事件与只属于它们的运行，再按新内容发送。新增端点 `POST /api/sessions/:sessionId/messages/:messageId/rewind`、全局事件 `session.reset`、端口 `ConversationRewindPort`（实现 `integrations/agy/rewind-terminal.ts`，依赖 `node-pty` 与 `@xterm/headless`）。详见 1.9、2.4 修订。
>
> | #    | agy-auto 怎么做                                              | agy-studio 现状                                              | 影响                                                         | 归属                            |
> | :--- | :----------------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- | :------------------------------ |
> | 1    | 删除会话时，除了 `brain/<id>/`，还删 `conversations/<id>.db`、`.db-shm`、`.db-wal`，并顺着 transcript 找出子代理的会话 id 一起删 | `brain-fs.ts` 第 253 行只删 `brain/<id>/` 这一个目录         | 删掉的会话在 agy 自己的历史列表里还在，子代理的数据残留，磁盘越积越多 | 1.5，1.9 要用到                 |
> | 2    | 支持 `--agent`：内置默认 agent，加上项目里的 `.agents/agents/*/agent.md` 和全局的 `~/.gemini/config/agents` | contracts 和架构文档里完全没有 agent 这个概念                | 用户没法选自定义 agent。agy 本身支持，`--help` 里有 `--agent` 参数 | 要改 contracts，影响 2.8 输入框 |
> | 3    | 处理 `error_message` 类型的步骤，显示成错误                  | `stream-adapter.ts` 只处理 `user_input`、`agent_response`、`tool`、`subagent`、`system_message` 五种 | 运行中途的报错（比如额度耗尽、接口出错）可能被当成未知事件，界面上看不到 | 1.4                             |
> | 4    | 同时扫描 CLI（`~/.gemini/antigravity-cli`）和 IDE（`~/.gemini/antigravity`）两个数据目录 | 只扫描 CLI 的目录                                            | 看不到你在 Antigravity IDE 里的对话                          | 可选，                          |

---

## 设计原则

1. **零移植**：不移植、不参考任何第三方 agy 包装项目的代码。关于 agy 的一切知识只有两个来源：
   - Antigravity **官方文档**（CLI 参数、stream-json 输出、settings、statusline、`/usage`、`/credits`、`models` 等命令）
   - 我们自己在本机做的**黑盒探测**（阶段 0 的探测模块，产出 fixtures 和 `agy-profile.json`）
2. **尽量少碰私有接口**：登录只走 agy 自己的登录流程，不自己实现 OAuth。唯一的例外是**额度查询**：直接调用官方客户端所用的额度接口（只读、低频），失效时额度面板显示"不可用"，不影响其他功能。为此允许从 agy 程序中读取其 OAuth 客户端标识，只在内存中使用，不写盘、不进仓库、不出现在日志里。
3. **agy 知识隔离**：所有与 agy 内部细节相关的代码只能放在 `backend/src/integrations/agy/`；所有"会随 agy 版本变化"的事实（路径、事件格式、settings 键名、凭据位置、命令输出格式）都写在数据文件 `agy-profile.json` 里，而不是散落在代码中。agy 升级时，重跑探测、更新 profile 和 fixtures 即可。
4. **端口与适配器**：服务层只依赖自己定义的接口（端口），由 integrations 层实现。换掉 agy 的某个行为，只需要换一个适配器。

---

## 阶段 0 · 需求定位与边界收敛

### 为谁解决什么

| 项 | 内容 |
|---|---|
| 用户 | 单个开发者，在自己的 Windows 机器上使用；偶尔用手机通过局域网或 Tailscale 查看 |
| 核心痛点 | Antigravity 的 "Always Proceed" 经常失效，长任务被确认弹窗卡住，必须有人守着 |
| 核心解法 | 用官方参数 `--dangerously-skip-permissions` 强制放行，再用多层兜底保证不卡；界面尽量做成 Antigravity 的样子 |

### MVP 做什么

1. **对话**：流式正文、主 agent 与子 agent 的思考过程、工具调用卡片、子 agent 嵌套时间线、停止运行
2. **强制自动同意**：四层兜底（CLI 参数、改写 settings、自动回复 permission 事件、卡死看门狗）
3. **会话**：新建、续聊、历史回放（刷新页面不丢过程）、导入磁盘上已有的 agy 会话、删除（可选连带清理 agy 文件）
4. **工作区**：选择项目目录作为 agy 的工作目录
5. **模型**：选择模型、effort、mode；保存默认值
6. **额度面板**：与官方一致的分组与 Weekly / 5h 桶，数据来自额度接口；接口失效时显示"不可用"
7. **账号**：列出、登录（弹出终端窗口由用户在 agy 中完成）、切换、删除；采用凭据快照方式，切换账号时换快照，同一时间只有一个账号在运行
8. ~~**Artifacts 面板**~~：已移除（2026-10-04）
9. **附件**：图片和文件上传（通过路径注入给 agent），PDF/Word/Excel 服务端转成文本
10. ~~**检查点**~~：已移除（2026-10-04），工作区安全交给用户自己的 git

### MVP 明确不做

| 不做 | 原因或后续安排 |
|---|---|
| 多用户、公网部署、云端运行 | 自动同意等于把本机权限交给 agent，只允许本机或内网使用 |
| 代码编辑器、完整 Git GUI、交互式终端 | 第二期 |
| MCP、Skills 管理界面 | 第二期 |
| 额度耗尽自动换号 | 有违反服务条款的风险，第二期作为默认关闭的开关 |
| 自己实现 Google 登录、调用额度以外的私有接口 | 违反设计原则 2 |
| 多个账号同时运行（独立 home 目录隔离） | 实现复杂且收益小；第二期再评估 |
| 定时任务、Web Push、插件系统、PWA | 第二期 |
| OpenAI 兼容接口、任何反代或中转 | 与目标无关 |
| 原生多模态图片输入 | 先验证（V4），MVP 用路径注入 |
| Docker 沙箱 | 第二期；MVP 不提供沙箱与回滚（检查点已于 2026-10-04 移除），由用户自己的 git 兜底 |

### 探测清单（阶段 0 的核心产出）

所有结论写入 `docs/VERIFY.md`，其中可以机器读取的部分写入 `backend/agy-profile.json`。

| 编号 | 要探明的问题 | 探测方法 | 影响的模块 | 探测失败时的降级方案 |
|---|---|---|---|---|
| V1 | 一个 stream-json 进程能否通过 stdin 连续接收多轮消息，user 帧格式是什么 | 录制多轮输入 | 1.6 | 每轮新起进程，带续聊参数 |
| V2 | 开了 skip-permissions 后，流里是否仍有 permission / confirmation 事件，格式和回复方式 | 构造写文件、执行命令、访问工作区外路径的任务并录制 | 1.7 | 只保留 settings 与看门狗两层 |
| V3 | stream-json 的全部事件类型与字段；主会话是否有思考内容，在流里还是在磁盘文件里 | 录制多场景 + 对照官方文档 | 1.4, 1.5 | 主 agent 思考只显示 token 数 |
| V4 | user 消息能否携带图片（数组、base64 或专用参数） | 录制 | 1.11 | 路径注入 |
| V5 | agy 在磁盘上的目录布局：会话、transcript、artifacts、截图、录屏分别在哪 | 运行前后对 `%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%` 做文件快照差异 | 1.5, 1.10 | 只用 stdout 事件，放弃 Artifacts 与子 agent 实时追踪 |
| V6 | settings 文件的位置（全局、工作区）以及"总是放行"对应的键名和取值 | 官方文档 + 在 IDE / CLI 中切换设置后做文件差异 | 1.7 | 只依赖 CLI 参数 |
| V7 | 登录凭据存在哪：Windows 凭据管理器的哪些条目、还是哪些文件；凭据内容的编码格式（只记录格式，不记录内容） | 登录前后对 `cmdkey /list` 输出和用户目录做差异 | 1.14, 1.17 | — （必须探明） |
| V8 | ~~覆盖 home 类环境变量后 agy 是否使用独立凭据~~ | 不再需要：当前设计只用 `credential_snapshot` | — | — |
| V9 | ~~statusline 在无界面模式下是否被调用~~ | 不再需要：取消 statusline 桥接 | — | — |
| V10 | 登录完成的判定方式（仅此一项；`/usage` 与授权链接格式不再需要） | 弹出终端登录，前后对比 live 凭据的变化 | 1.15 | 若轮询 live 凭据不可靠，由架构师在 contracts 中增加"确认登录完成"端点 |
| V11 | `agy --version`、`agy models` 的输出格式；mode 的可选值 | 直接运行 | 1.13 | 使用默认值 |
| V12 | 额度接口的请求与响应格式（只记录字段结构，token 与邮箱脱敏） | 用本机已登录账号调用一次，保存脱敏后的响应 | 1.17 | 额度显示为"不可用" |

### 参考资料

| 来源 | 用法 |
|---|---|
| [Antigravity 官方文档](https://antigravity.google/docs) | 唯一的外部知识来源 |
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)（AGPL-3.0） | 只看它的**架构文档**学习思路（WebSocket 按 seq 重放、运行归服务端所有、附件路径注入），**不看不抄源码** |
| vercel/ai-elements、assistant-ui（MIT / Apache） | 可以作为 npm 依赖直接使用的前端组件库 |
| agy-auto（作者本人的项目） | 可以参考它对 agy 行为的摸索结论（凭据位置、额度接口）；结论必须经过本机探测验证并写入 VERIFY.md 与 fixtures 后才能使用，代码按本项目分层重写 |

---

## 阶段 1 · 前后端契约规范（Contract-First）

契约全部在 `contracts/src/`，前后端**只能**从 `@agy-studio/contracts` 导入类型，互相之间不能 import。

| 文件 | 内容 |
|---|---|
| `errors.ts` | `ErrorCode` 联合类型、`ApiErrorBody`、错误码到 HTTP 状态码的映射 |
| `domain.ts` | 领域模型：Workspace、Session、Run、ToolCall、SubagentInfo、TranscriptStep、Attachment、Model、Prefs、Account、QuotaSnapshot、Capabilities |
| `events.ts` | 会话事件 `AgentEvent`（持久化、按 seq 回放）、`SessionEventEnvelope`、全局事件 `GlobalEvent` |
| `ws.ts` | WebSocket 帧 `ClientFrame` / `ServerFrame` 与相关常量 |
| `api.ts` | REST 端点表 `ApiEndpoints` 与上传限制 |

### 1.1 通信模型

```text
REST : 查询与管理（会话列表、历史事件分页、子 agent transcript、额度、账号、附件上传）
WS   : 实时事件推送 + 发送消息 + 中止运行（单连接订阅多个会话）
```

实时事件和历史事件都来自数据库的 `events` 表：WebSocket 推送的是刚写入的事件，REST 按 `afterSeq` 分页读取的是同一张表。前端不需要合并两套数据。

### 1.2 WebSocket 协议

| 方向 | 帧 | 说明 |
|---|---|---|
| C→S | `session.subscribe {sessionIds, lastSeq}` | 服务端先补发 `seq > lastSeq` 的事件（每批 500 条），再切到实时推送。同一连接对已订阅的会话再次 subscribe 时（客户端发现跳号会这样做），服务端必须**替换**原订阅并按新的 `lastSeq` 重新补发，不能再挂一份，否则每条实时事件会被推送多次 |
| C→S | `session.send {requestId, sessionId, text, attachmentIds, model?, effort?, mode?}` | 成功回 `ack {runId}`，失败回 `nack {error}` |
| C→S | `run.abort {requestId, runId}` | 中止；之后仍会收到一条 `run.completed(status=aborted)` |
| C→S | `ping` | 每 20 秒一次 |
| S→C | `event {envelope}` | 会话事件，`seq` 在单个会话内单调递增且连续 |
| S→C | `subscribed {latestSeq, activeRunId}` | `latestSeq` 小于客户端持有的值时，客户端清空该会话后从 0 重新订阅 |
| S→C | `global {event}` | 会话列表变化、运行状态、账号变化、额度更新 |

### 1.3 事件不变量

1. 每次运行恰好一条 `run.started`、恰好一条 `run.completed`，无论成功、失败还是中止
2. `run.error` **不是**终止事件
3. `seq` 在单个会话内从 1 开始连续递增，只由服务端分配。唯一的例外是「编辑重问」截断历史：删除 `seq >= N` 的事件后从 N 重新分配，并广播 `session.reset`，客户端收到后丢弃该会话的本地状态重新加载
4. 前端界面状态 = 按 seq 顺序对事件做纯函数 reduce 的结果
5. 无法识别的 agy 输出一律转成 `raw` 事件，不允许抛异常中断整个流

### 1.4 REST 端点（完整定义见 `contracts/src/api.ts`）

| 分组 | 端点 |
|---|---|
| 系统 | `GET /api/health`、`GET /api/capabilities` |
| 工作区 | `GET/POST /api/workspaces`、`DELETE /api/workspaces/:id` |
| 会话 | `GET/POST /api/sessions`、`GET/PATCH/DELETE /api/sessions/:id`、`POST /api/sessions/import`、`POST /api/sessions/:id/messages/:messageId/rewind` |
| 事件与运行 | `GET /api/sessions/:id/events?afterSeq&limit`、`GET /api/sessions/:id/runs` |
| 子 agent | `GET /api/sessions/:id/subagents/:conversationId/transcript` |
| 附件 | `POST /api/attachments`、`GET /api/attachments/:id/raw` |
| 模型与偏好 | `GET /api/models`、`GET/PUT /api/prefs` |
| 额度 | `GET /api/quota?account&refresh` |
| 账号 | `GET /api/accounts`、`POST /api/accounts/save`、`POST /api/accounts/switch`、`DELETE /api/accounts/:name`、`POST /api/accounts/login`、`GET/DELETE /api/accounts/login/:loginId` |

### 1.5 仅后端内部使用的接口（不属于前后端契约）

当前设计中没有。原先为 statusline 桥接预留的 `POST /internal/statusline` 随模块 1.16 一起取消。

### 1.6 鉴权

- 默认只监听 `127.0.0.1`，不校验 token
- 监听非回环地址时**必须**设置 `AGY_STUDIO_TOKEN`，否则拒绝启动
- REST 用 `Authorization: Bearer <token>`，WS 用 `?token=`

---

## 阶段 2 · 物理架构与模块拆分

### 2.1 总体结构

```text
┌──────────── frontend (React SPA) ────────────┐
│ views → stores → api client (REST + WS)      │
└───────────────────┬──────────────────────────┘
                    │ 只通过 contracts 通信
┌───────────────────▼──────────── backend ────────────────────────────────┐
│ routes：http 路由 · ws 网关 · internal 路由                               │
│   ↓                                                                      │
│ services：session · run-supervisor · autoapprove · event-bus             │
│           subagent-transcript · attachment · account · quota             │
│           model · prefs · workspace                                      │
│   ↓ 只依赖 services/ports 中定义的接口                                     │
│ integrations/agy（防腐层，唯一了解 agy 的地方）                             │
│   profile · process · stream-adapter · brain-fs · transcript · settings  │
│   credential-store · login-terminal · quota-api · catalog                │
│   ↓                                                                      │
│ repositories (SQLite)                utils                               │
└───────┬───────────────────────┬─────────────────────┬────────────────────┘
        │ spawn                 │ fs 监听              │ HTTPS（只读、低频）
    agy 进程                agy 数据目录             额度接口
```

### 2.2 后端分层

| 层 | 目录 | 职责 | 依赖规则 |
|---|---|---|---|
| 路由层 | `backend/src/routes/` | zod 校验、调用 service、错误映射；WS 网关；internal 路由 | 只能调用 services |
| 服务层 | `backend/src/services/` | 业务逻辑、状态机、锁、缓存 | 只能依赖 `services/ports/` 中的接口、repositories、utils；**不能** import `integrations/` |
| 端口 | `backend/src/services/ports/` | 服务层需要的外部能力接口（见 §2.3） | 只依赖 contracts |
| 防腐层 | `backend/src/integrations/agy/` | 实现端口；所有 agy 相关的路径、格式、命令都只在这里出现，并从 profile 读取 | 可以用 utils；不能 import services（除 ports 的类型） |
| 数据层 | `backend/src/repositories/` | SQLite 读写 | 只能用 utils |
| 工具层 | `backend/src/utils/` | 配置、日志、错误类、进程树终止、JSONL 增量读取、退避、锁 | 不依赖任何上层 |

装配只在 `backend/src/app.ts` 中进行：创建 integrations 的实现，注入给 services。

### 2.3 端口定义（服务层视角）

| 端口 | 能力 | 实现（integrations/agy） |
|---|---|---|
| `AgyRunnerPort` | 启动一个 agy 运行进程，逐条产出 `AgentEvent`，写入后续消息，终止 | `process.ts` + `stream-adapter.ts` |
| `BrainPort` | 定位会话目录、列出磁盘上的会话、读取 / 追踪 transcript、清理会话文件 | `brain-fs.ts` + `transcript.ts` |
| `SettingsPort` | 确保 settings 为"总是放行" | `settings.ts` |
| `CredentialPort` | 读取当前凭据状态、做快照、恢复、清空（`credential_snapshot` 模式） | `credential-store.ts` |
| `LoginPort` | 弹出一个真实的终端窗口运行 agy 让用户自己登录，并检测登录完成 | `login-terminal.ts` |
| `QuotaProbePort` | 读取当前账号的 token，调用额度接口，解析成 `QuotaSnapshot` | `quota-api.ts` |
| `HomeIsolationPort`、`StatuslineParserPort` | 模块 1.3 已定义，当前设计**不实现**，保留端口文件供第二期使用 | — |
| `ModelCatalogPort` | 获取模型列表、版本号、mode 可选值 | `catalog.ts` |
| `ConversationRewindPort` | 把 agy 对话回退到某条用户消息之前（编辑重问） | `rewind-terminal.ts` |

### 2.4 agy-profile.json（agy 知识的数据化）

由探测模块生成，模块 1.3 用 zod 校验并加载。示意结构如下（具体字段以 1.3 的 schema 为准）：

```text
{
  agyVersion, discoveredAt,
  binary:      { candidates[] },
  stream:      { userFrameTemplate, multiTurnStdin, eventTypeMap{}, permissionEvent{match, replyTemplate} | null,
                 imageInput{supported, template} },
  paths:       { dataRoots[], conversationDirPattern, transcriptRelPath },
  transcript:  { taskResultPattern } | 缺省,   // 1.5 后台命令结果（SYSTEM_MESSAGE）的匹配正则
  settings:    { files[{scope, pathTemplate}], alwaysProceed{jsonPath, value} },
  credentials: { preferredIsolation: 'credential_snapshot', wincredTargetPatterns[], credentialFiles[] },
  login:       { argv[], ... },            // 1.15 只用 argv 在终端窗口中启动 agy，其余字段不再使用
  quota:       { ... },                    // 1.17 额外需要的接口地址等写入 profile，字段由 1.17 在 schema 中补充
  catalog:     { versionArgv[], modelsArgv[], modelsParser: 'text-v1', modes[] }
}
```

规则：
- 代码中**不允许**出现硬编码的 agy 路径、键名、命令输出格式，一律从 profile 读取
- 启动时比较 `agy --version` 与 `profile.agyVersion`，不一致时在 capabilities 中标出（`agyVersion` / `profileAgyVersion`）。对话视图不因此弹提示条
- **2026-10-03 修订**：去掉 ManagerView 顶部「agy 已升级，建议重新探测」。CLI 与 profile 版本差本身不影响当前运行，横幅对日常使用没有帮助

### 2.5 服务职责边界

| 服务 | 职责 | 不负责 |
|---|---|---|
| `run-supervisor` | 运行状态机、并发上限、同会话互斥、超时、"恰好一次完成"守卫、孤儿进程清理、向 account 服务申请租约 | 解析 agy 输出 |
| `autoapprove` | 运行前确保 settings 放行；把 permission 事件交给 runner 自动回复；卡死看门狗 | 知道 settings 文件在哪（由 SettingsPort 负责） |
| `event-bus` | 分配 seq、合并文本 delta、批量写库、推送 | 解析 agy 输出 |
| `transcript-follow` | 运行期间追踪主会话 transcript，stdout 被压住时补发消息与工具事件（按 id 与 stdout 去重），并向 run-supervisor 报告进展 | 解析 transcript（由 BrainPort 负责）；思考内容 |
| `account` | 账号库、租约（读写锁）、切换、登录编排 | 凭据怎么存（由 CredentialPort 负责） |
| `quota` | 按账号缓存、限流、失败时保留旧数据、广播 | 怎么拿 token、接口长什么样（由 QuotaProbePort 负责） |
| `subagent-transcript` | 校验子会话属于该会话，分页返回子 agent transcript（原在 artifact 服务中） | 读取 transcript 的细节（由 BrainPort 负责） |

### 2.6 账号模型与租约

只实现 `credential_snapshot` 模式（`isolated_home` 留到第二期）：

| 项 | 说明 |
|---|---|
| 原理 | agy 只有一个 live 凭据槽位（Windows 凭据管理器中的条目，以及 `profile.credentials.credentialFiles` 列出的文件）；每个账号保存一份加密快照，切换时用快照整体替换 live 槽位 |
| 并发 | 同一时间只使用 live 账号；不同会话可以并发运行，但都用 live 账号 |
| 会话 | `Session.accountName` 记录运行时的账号，仅用于展示 |
| 切换 | 需要没有任何运行；切换期间禁止新运行 |

**租约（读写锁）**：`account.acquireLease()` 返回租约，运行结束释放。
- 运行和额度查询持有**读锁**（可以多个并存）
- 切换、登录、删除 live 账号持有**写锁**：要求读锁数为 0，持有期间新的读锁请求立即失败（返回 `ACCOUNT_SWITCH_IN_PROGRESS`，不排队，避免死锁）

### 2.7 额度来源

只有一个来源：**额度接口**。

| 项 | 说明 |
|---|---|
| 触发 | 前端打开额度面板或点刷新；缓存过期且有页面在看 |
| 过程 | 读取 live 凭据中的 refresh token → 换取 access token（只保存在内存，过期前复用）→ 调用额度接口 → 解析成 `QuotaSnapshot`，`source='quota_api'` |
| 限流 | 每账号最多 1 分钟一次，同时到达的请求合并为一次 |
| 失败 | 保留旧数据并标 `stale`；从未成功过则 `source='unavailable'`，前端显示"额度不可用"，不影响其他功能 |
| 安全 | OAuth 客户端标识从 agy 程序中读取后只保存在内存；token、客户端标识都不写日志、不写盘、不返回给前端 |

### 2.8 运行状态机

```text
queued ──► starting ──► running ──► completed
   │           │          │  ▲
   │           │          ▼  │ 有新输出
   │           │        stalled ──►（看门狗注入同意后仍无输出）──► failed(AGY_STALLED)
   │           │
   └───────────┴──────────┴──► aborted（用户中止）
                               failed（非零退出 / 启动失败 / 超时 / 拿不到账号租约）
```

- 同一会话同时只能有一个非终止运行 → 否则 `SESSION_BUSY`
- 全局运行数上限 `Prefs.maxConcurrentRuns`（默认 3）→ 否则 `CONCURRENCY_LIMIT`
- 进入 `starting` 前必须拿到账号读锁 → 否则 `ACCOUNT_SWITCH_IN_PROGRESS`

### 2.9 数据库表（SQLite，WAL 模式）

| 表 | 主要字段 |
|---|---|
| `workspaces` | id, name, path(unique), is_git_repo, created_at, last_opened_at |
| `sessions` | id, workspace_id, account_name, title, agy_conversation_id, status, model, effort, mode, source, last_run_id, last_seq, created_at, updated_at |
| `runs` | id, session_id, status, model, account_name, pid, usage_json, error_json, started_at, ended_at |
| `events` | session_id, seq, run_id, ts, type, payload_json；主键 (session_id, seq) |
| `attachments` | id, workspace_id, session_id, kind, original_name, mime_type, size, stored_path, derived_text_path, created_at |
| `accounts` | name, type, isolation, email, note, saved_at, is_default（**不存凭据**） |
| `quota_cache` | account_name, source, snapshot_json, fetched_at |
| `prefs` | key, value_json |
| `schema_migrations` | version, applied_at |

凭据只存在两个地方：agy 自己的 live 槽位（由 agy 写入），以及 `DATA_DIR/credentials/<name>/` 中加密保存的快照（用 Windows DPAPI 加密，只有当前 Windows 用户能解密）。

### 2.10 前端分层

| 层 | 目录 | 职责 |
|---|---|---|
| API 客户端层 | `frontend/src/api/` | `http.ts`：按 `ApiEndpoints` 类型化的 fetch 封装；`ws.ts`：心跳、指数退避重连、按 lastSeq 重新订阅 |
| 状态层 | `frontend/src/stores/` | zustand：session（每个会话一个槽位）、workspace、prefs、quota、account、connection、ui |
| 纯逻辑 | `frontend/src/domain/` | `timelineReducer.ts`：事件 → 时间线条目的纯函数；`displayRows.ts`：条目 → 展示行（Worked 分段、同类计数）的纯函数 |
| 页面层 | `frontend/src/views/` | ManagerView、AccountsView、SettingsView |
| 组件层 | `frontend/src/components/` | 无状态展示组件：思考块、工具卡片、终端输出、子 agent 卡片、Markdown、输入框、附件、额度、账号等 |

时间线条目（前端内部类型）：`UserMessageItem`、`ThinkingItem`、`AssistantMessageItem`、`ToolItem`、`ToolGroupItem`、`SubagentItem`、`RunDividerItem`、`ErrorItem`、`StalledNoticeItem`。

### 2.11 界面布局（对标 Antigravity）

```text
┌ 顶栏：工作区 ▾ │ 额度环 │ 账号 ▾ │ 连接状态 ┐
├──────────┬────────────────────────────────┬──────────────────────────┤
│ 收件箱    │ ▸ Thought for 12s（默认折叠）    │ [Task][Plan][Walkthrough] │
│ ● 运行中  │ ▸ Edited src/a.ts  +12 −3      │ [Media][Changes]          │
│ ◐ 待查看  │ ▸ Ran `npm test`（终端输出）     │                           │
│ ✓ 已完成  │ ▸ 子 agent：researcher（可展开）  │                           │
│          │ 回复（Markdown）                 │                           │
│          │ ┌ 输入框 · 附件 · 发送/停止 ┐      │                           │
└──────────┴────────────────────────────────┴──────────────────────────┘
```

---

## 阶段 3 · 项目目录骨架与初始 Git 存档

### 3.1 目录树

```text
agy-studio/
├─ package.json                  # npm workspaces: contracts, backend, frontend, tools/*
├─ tsconfig.base.json
├─ .gitignore                    # node_modules, dist, *.db, .agy-studio/, fixtures/private/
├─ contracts/                    # ✅ 已完成
│  └─ src/{errors,domain,events,ws,api,index}.ts
├─ backend/
│  ├─ agy-profile.json           # 探测模块生成，提交到仓库（已脱敏）
│  └─ src/
│     ├─ main.ts · app.ts
│     ├─ routes/
│     │  ├─ http/{system,workspaces,sessions,subagents,attachments,models,prefs,quota,accounts}.routes.ts
│     │  └─ ws/gateway.ts
│     ├─ services/
│     │  ├─ ports/{agy-runner,brain,settings,credential,login,quota-probe,model-catalog}.port.ts
│     │  ├─ run-supervisor.ts · event-bus.ts · session.ts · workspace.ts
│     │  ├─ autoapprove/{autoapprove,watchdog}.ts
│     │  ├─ subagent-transcript.ts · attachment/{store,convert,prompt-inject}.ts
│     │  ├─ account/{account,lease-lock}.ts · quota.ts · model.ts · prefs.ts
│     ├─ integrations/agy/
│     │  ├─ profile/{schema,loader}.ts
│     │  ├─ process.ts · stream-schema.ts · stream-adapter.ts
│     │  ├─ brain-fs.ts · transcript.ts · settings.ts
│     │  ├─ credential-store.ts · dpapi.ts
│     │  ├─ login-terminal.ts · quota-api.ts · oauth-client.ts
│     │  ├─ catalog.ts
│     ├─ repositories/{db,migrations,workspaces,sessions,runs,events,attachments,accounts,quota-cache,prefs}.ts
│     └─ utils/{config,logger,errors,proc-tree,jsonl-tail,backoff,rw-lock,ids}.ts
├─ frontend/
│  └─ src/{main.tsx,App.tsx,theme.css,api/,stores/,domain/,views/,components/}
├─ tools/
│  ├─ discover/                  # 探测脚本：录制 stream、文件差异、凭据差异、额度接口响应（脱敏）
│  ├─ fake-agy/                  # 回放 fixtures 的假 agy
│  └─ smoke/                     # 用真实 agy 跑的冒烟测试（不进 CI，检查点时手动运行）
├─ fixtures/agy/                 # 录制的 stdout、transcript、磁盘布局、脱敏后的额度接口响应
├─ e2e/
└─ docs/{ARCHITECTURE.md,VERIFY.md}
```

### 3.2 技术选型

| 部分 | 选型 |
|---|---|
| 运行时 | Node 20+，TypeScript，ESM |
| 后端 | Fastify + `@fastify/websocket` + `@fastify/multipart`，zod，pino |
| 数据库 | better-sqlite3（WAL） |
| 凭据 | `@napi-rs/keyring`（读写 Windows 凭据管理器）+ DPAPI 加密快照 |
| 文件监听 | chokidar |
| 进程 | `child_process.spawn`（不用 shell）；Windows 下 `taskkill /T /F` 终止进程树 |
| 伪终端 | `node-pty` + `@xterm/headless`，仅用于驱动 agy 的交互式 `/rewind`（自带预编译文件，无需编译） |
| 文档转换 | pdf-parse、mammoth、xlsx |
| 前端 | Vite + React 18 + TS + Tailwind + shadcn/ui + zustand + react-markdown + shiki + `@tanstack/react-virtual` |
| 测试 | vitest、Playwright（配合 fake-agy） |

### 3.3 初始存档

```bash
git init
git add .
git commit -m "chore: 初始化前后端物理骨架与API契约定义"
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

---

## 阶段 4 · 乐高积木分块与红绿灯风险评级

### 4.1 评级规则

| 灯 | 含义 | 审核策略 |
|---|---|---|
| 🟢 简单 | 纯 UI、原子组件、简单读取工具 | 执行模型完成、本地自测通过后直接提交，不需要 Opus 复审 |
| 🟡 核心 | 数据转换、持久化、常规 API 串联 | 单元测试通过即提交，到集成检查点统一复查 |
| 🔴 高危 | 并发与竞态、状态机、凭据流转、断线重连、会破坏用户文件的操作 | ⚠️ 写完**立即**唤醒 Opus 做单模块深度审查，通过后再提交 |

### 4.2 模块总览

| 模块 | 名称 | 灯 | 依赖 |
|---|---|---|---|
| 0.1 | Monorepo 骨架与工具链 | 🟢 | contracts |
| 0.2 | 探测一：stream 录制（V1–V4） | 🟡 | 0.1 |
| 0.3 | 探测二：环境探测（V5–V11）与 profile 草稿 | 🟡 | 0.1 |
| 0.4 | fake-agy 回放器 | 🟢 | 0.2, 0.3 |
| 1.1 | 后端工具层 | 🟢 | 0.1 |
| 1.2 | 数据层 | 🟡 | 1.1 |
| 1.3 | profile schema 与加载、端口定义 | 🟢 | 0.3, 1.1 |
| 1.4 | stream schema 与适配器 | 🟡 | 0.2, 1.3 |
| 1.5 | agy 数据目录与 transcript | 🟡 | 0.3, 1.3 |
| 1.6 | 进程与 RunSupervisor | 🔴 | 1.2, 1.4, 0.4 |
| 1.7 | 自动同意四层兜底 | 🔴 | 1.6 |
| 1.8 | EventBus 与 WS 网关 | 🔴 | 1.2, 1.6 |
| 1.9 | 会话与工作区服务、REST | 🟡 | 1.5, 1.8 |
| 1.10 | ~~Artifacts 服务与 REST~~（已移除） | 🟡 | 1.5, 1.8 |
| 1.11 | 附件服务 | 🟡 | 1.2, 1.9 |
| 1.12 | ~~检查点（影子 git）~~（已移除） | 🔴 | 1.2, 1.6 |
| 1.13 | 模型、偏好、系统接口 | 🟢 | 1.2, 1.3 |
| 1.14 | 凭据快照与账号服务 | 🔴 | 1.2, 1.3, 1.6 |
| 1.15 | 终端窗口登录 | 🟡 | 1.14 |
| 1.16 | ~~statusline 桥接与接收~~（已取消） | — | — |
| 1.17 | 额度接口与缓存 | 🔴 | 1.14 |
| 1.18 | 后端装配与启动 | 🟡 | 1.6–1.15, 1.17 |
| — | **集成检查点 A：后端联调，Opus 统一复查 🟡 模块** | | |
| 2.1 | 前端骨架与主题 | 🟢 | 0.1 |
| 2.2 | HTTP 客户端 | 🟡 | 2.1 |
| 2.3 | WS 客户端 | 🔴 | 2.1 |
| 2.4 | 时间线 reducer | 🟡 | 2.1 |
| 2.5 | 状态层 stores | 🟡 | 2.2, 2.3, 2.4 |
| 2.6 | 时间线原子组件 | 🟢 | 2.1 |
| 2.7 | 子 agent 卡片 | 🟡 | 2.5, 2.6 |
| 2.8 | 输入框与附件 | 🟡 | 2.5 |
| 2.9 | 收件箱、工作区与新建会话 | 🟢 | 2.5 |
| 2.10 | ~~Artifacts 面板~~（已移除） | 🟡 | 2.5 |
| 2.11 | 额度面板与账号界面 | 🟢 | 2.5 |
| 2.12 | ~~检查点 diff 与回滚界面~~（已移除） | 🟡 | 2.5 |
| 2.13 | 对话视图组装 | 🟡 | 2.6–2.12 |
| — | **集成检查点 B：前端联调，Opus 统一复查 🟡 模块** | | |
| 3.1 | 端到端测试 | 🟡 | 1.18, 2.13 |
| 3.2 | 启动脚本与 README | 🟢 | 3.1 |

后端 1.x 与前端 2.x 可以并行；前端开发期间用 fake-agy 起真实后端。

---

### 4.3 模块明细

#### 0.1 Monorepo 骨架与工具链 🟢
- **交付物**：根 `package.json`（workspaces）、`tsconfig.base.json`、`.gitignore`、backend 与 frontend 空壳、ESLint + Prettier、根脚本 `dev/build/test/typecheck/lint`
- **完成标准**：`npm install && npm run typecheck && npm run build && npm test` 通过；前后端都能 `import type` 契约
- **2026-10-03 修订**：根目录新增 `.npmrc`（`ignore-scripts=true`）。better-sqlite3 自带各平台预编译文件（`prebuilds/win32-x64.node` 等），但包里有 `binding.gyp`，npm 会隐式执行 `node-gyp rebuild`，在没装 Visual Studio C++ 工具链的机器上安装失败。依赖树里另外两个安装脚本（esbuild 校验、fsevents）都可省略，因此全部跳过，`npm install` 不再需要 Visual Studio
- **2026-10-04 修订**：backend 新增 `vitest.config.ts`，`testTimeout`/`hookTimeout` 设为 20 秒。很多后端测试会真实拉起 git 或 node 子进程，Windows 上全量并行跑时经常超过 vitest 默认的 5 秒（并非卡死），此前全量运行有 6 个用例因此偶发失败

#### 0.2 探测一：stream 录制 🟡
- **交付物**：`tools/discover/record-stream.ts`；`fixtures/agy/stream/<场景>/{stdout.jsonl,stderr.txt,meta.json}`（每行带相对时间戳）；`docs/VERIFY.md` 中 V1–V4 的结论
- **场景**：纯对话、读写文件、执行命令、子 agent、额度耗尽、带图片路径、中途中止、多轮 stdin、访问工作区外路径
- **说明**：参数与 user 帧格式先按官方文档写，录到的结果以实际为准；需要人工在本机运行

#### 0.3 探测二：环境探测 🟡
- **交付物**：`tools/discover/` 下的 `fs-diff.ts`（对用户目录做快照差异）、`cred-diff.ts`（对 `cmdkey /list` 做差异）、`isolation-test.ts`（覆盖 home 类环境变量后运行 agy）、`statusline-capture.ts`（安装一个把 stdin 写文件的 statusline 命令）、`pty-record.ts`（在伪终端中运行 `/usage`、`/credits`、登录流程并保存原始输出）、`catalog-probe.ts`（版本、模型、mode）；产出 `fixtures/agy/{fs,pty,statusline}/`、`docs/VERIFY.md` 中 V5–V11 的结论、`backend/agy-profile.draft.json`
- **2026-09-28 修订**：`isolation-test`、`statusline-capture`、`pty-record` 及其产物随 1.16 取消与 1.15/1.17 简化而不再需要（已有的 `fixtures/agy/pty/`、`statusline/` 是编造数据，不得作为依据）；改为补充 `quota-probe.ts`：用本机已登录账号调用一次额度接口，把脱敏后的响应写入 `fixtures/agy/quota/`（V12）
- **完成标准**：VERIFY.md 每项都有"结论 / 证据文件 / 对实现的影响"；所有产物已脱敏
- **说明**：探测脚本在运行任何会修改凭据或 settings 的操作前，必须先备份，结束后恢复

#### 0.4 fake-agy 回放器 🟢
- **交付物**：`tools/fake-agy/`：按场景回放 stdout，把 transcript 写到 `FAKE_AGY_HOME` 下 profile 描述的位置；与真实 agy 一样，回放完 `result` 后等待 stdin 关闭才退出
- **完成标准**：设置 `AGY_BIN=<fake-agy>` 与 `FAKE_AGY_HOME` 后，后端感知不到区别

#### 1.1 后端工具层 🟢
- **交付物**：`utils/` 下 `config`（HOST、PORT、AGY_STUDIO_TOKEN、AGY_BIN、DATA_DIR；非回环地址无 token 时抛错）、`logger`（pino，自动脱敏 token / 凭据字段）、`errors`（`AppError`，code 用契约的 `ErrorCode`）、`proc-tree`、`jsonl-tail`（增量读取、半行、文件不存在、截断）、`backoff`、`rw-lock`（读写锁，写锁请求期间新读锁立即失败）、`ids`
- **完成标准**：每个文件都有单元测试；`rw-lock` 覆盖并发场景

#### 1.2 数据层 🟡
- **交付物**：`repositories/` 下 db、migrations 与 §2.9 每张表一个 repo；`events.appendBatch` 在事务内写入并更新 `sessions.last_seq`
- **完成标准**：repo 方法使用契约类型；基于临时数据库的集成测试

#### 1.3 profile schema 与加载、端口定义 🟢
- **交付物**：`integrations/agy/profile/schema.ts`（按 §2.4 用 zod 定义完整 schema）、`loader.ts`（加载 `backend/agy-profile.json`，校验失败时给出精确的字段路径）；`services/ports/*.port.ts`（§2.3 的全部接口，只含类型）
- **完成标准**：0.3 产出的草稿能通过校验（或者列出需要人工补全的字段）；端口文件没有任何实现代码

#### 1.4 stream schema 与适配器 🟡
- **交付物**：`integrations/agy/stream-schema.ts`（根据 fixtures 为每种原始事件写 zod schema，未知字段放行）；`stream-adapter.ts`（纯函数，原始行 → `AgentEvent[]`；事件类型的映射表来自 `profile.stream.eventTypeMap`；工具名映射到 `ToolKind`；从编辑类工具参数中提取 `FileChange`）
- **完成标准**：对每个 fixture 做快照测试；schema 校验失败的行产出 `raw`；适配器无副作用

#### 1.5 agy 数据目录与 transcript 🟡
- **交付物**：`integrations/agy/brain-fs.ts`（按 profile 定位会话目录、列出磁盘会话、清理会话文件——**只删除**匹配 `conversationDirPattern` 且 id 为 UUID 的路径）；`transcript.ts`（解析与增量追踪，按步骤序号去重，`stop()` 释放资源）；实现 `BrainPort`
- **完成标准**：清理函数对路径穿越、非 UUID、符号链接一律拒绝；追踪用"逐行追加写入的临时文件"测试
- **2026-10-01 修订**：实测 agy 的 stream-json 按步骤顺序输出，某个后台工具步骤一直处于 RUNNING（如 `ssh` 等密码）时，其后所有 stdout 事件都被压住，而 transcript 仍实时写入。为此新增：`transcript.ts` 的 `RunTranscriptMapper`（只用于运行期间的主会话：本次运行的 USER_INPUT 之后，PLANNER_RESPONSE 正文 → `message.delta`+`message.done`，其 tool_calls 按顺序与后续 GENERIC 结果步骤配对 → `tool.started`/`tool.finished`；id 与 stream 适配器相同，均由会话级步骤序号生成——`stepMessageId`/`stepToolCallId`；不产出思考；transcript.jsonl 中被二次 JSON 编码的参数会解码，并去掉 `toolAction`/`toolSummary`）；`BrainPort.followRunTranscript`（可选能力，每个新步骤产出一批事件，空批即"有进展"心跳）。服务层 `services/transcript-follow.ts` 负责消费：transcript 事件等待 3 秒宽限期，期间 stdout 已发过同一 id 则丢弃；stdout 后到的、已由 transcript 完整发出的消息丢弃（前端按追加拼接 delta，不能重复），已由 transcript 标记结束的工具不再回到运行中；`toEvents` 仍只产出思考（导入历史不变）
- **2026-10-01 修订**：后台命令在 transcript 里的 GENERIC 步骤一直停在 RUNNING，真正的结果出现在之后的 SYSTEM_MESSAGE 步骤中（`Task id "<会话>/task-N" finished with result: …`，N 即该 GENERIC 步骤序号）。`RunTranscriptMapper` 记录运行中的工具，用 profile 新增的 `transcript.taskResultPattern`（命名分组 `step`、`exitCode`、`output`）匹配 SYSTEM_MESSAGE，产出该工具的 `tool.finished`（退出码非 0 时为 failed，`error` 为 `exit code X`）；profile 未配置该字段时不处理。stdout 路径不变，仍以 stdout 为准

#### 1.6 进程与 RunSupervisor 🔴
- **交付物**：`integrations/agy/process.ts`（实现 `AgyRunnerPort`：spawn 不用 shell、`windowsHide`、按 profile 模板写 user 帧、stdout 按行切分并交给适配器、终止进程树、支持注入额外环境变量——用于 home 隔离）；`services/run-supervisor.ts`（§2.8 状态机、同会话互斥、并发上限、超时、租约申请与释放、pid 入库、启动时清理孤儿进程、"恰好一次完成"守卫）
- **潜在死穴**：
  - close、error、abort、超时同时触发，导致 `run.completed` 发两次或一次都没发
  - Windows 下子进程（浏览器、终端）没被终止
  - stdout 最后半行在 close 时丢失
  - 监听器抛异常拖垮运行
  - 同会话双击发送绕过互斥（检查与写入必须在同一段同步代码中）
  - 运行异常退出时账号租约没有释放，导致之后永远无法切换账号
- **完成标准**：fake-agy 覆盖正常、非零退出、中止、超时、并发上限、双击、租约获取失败；每种情况恰好一条 `run.completed`，租约数归零，无残留进程
- **2026-10-01 修订**：默认不再设运行总时长上限（原 10 分钟会强杀正常的长任务，`timeoutMs` 仍可按次传入）；卡死改由 1.7 的看门狗处理，其无输出时长取 prefs 的 `stallTimeoutSeconds`（默认 180 秒，有命令类工具运行时放宽 3 倍），每次运行开始时读取，修改后下一次运行生效
- **2026-10-04 修订**：`ProcessRunner` 改用 `resolveRunnerBinary`（先 `findAgyBinary` 找实际存在的候选，找不到再退回 `resolveBinary`），与 1.13 模型目录、1.15 登录的查找方式一致。原来未设 `AGY_BIN` 时直接用 profile 第一个候选 `agy`，agy 位于 `%LOCALAPPDATA%\agy\bin` 但不在本进程 PATH 中时（典型：刚装完 agy、资源管理器还没拿到新 PATH 就双击 `start.cmd`），模型列表和登录正常，唯独每次运行都报 `spawn agy ENOENT`。注意：在同一进程内修改 `process.env.PATH` 不影响 Windows 下子进程的可执行文件查找，复现需从不含该目录的新进程启动

#### 1.7 自动同意四层兜底 🔴
- **交付物**：L1 参数由 1.6 固定带上；L2 `integrations/agy/settings.ts`（实现 `SettingsPort.ensureAlwaysProceed(scope, homeDir?)`：按 profile 读合并写，原子替换，保留其他字段）；L3 由 runner 根据 `profile.stream.permissionEvent` 自动回复，服务层只接收 `autoapprove.injected` 事件；L4 `services/autoapprove/watchdog.ts`（无输出超时 → stalled → 尝试注入 → 再超时 → `AGY_STALLED`；有命令类工具运行时计时放宽 3 倍）
- **潜在死穴**：把长命令（如依赖安装）误判为卡死；settings 被 IDE 同时写入导致文件损坏
- **完成标准**：settings 写入前后其他字段不变；fake-agy 覆盖 permission 事件与卡死两条链路
- **2026-10-01 修订**：stdout 被压住时 agy 并未卡死，看门狗不能只看 stdout。新增 `Watchdog.touch()` 与 `RunSupervisor.noteActivity(runId)`：`transcript-follow` 每读到本次运行的一个新 transcript 步骤就调用一次，重置无输出计时与 stalled 状态（见 1.5 修订）

#### 1.8 EventBus 与 WS 网关 🔴
- **交付物**：`services/event-bus.ts`（每会话串行队列、连续 seq、delta 在 50ms 窗口内合并、每 50ms 或 100 条批量写库、写库成功后再推送）；`routes/ws/gateway.ts`（鉴权、订阅时补发与实时的无缝衔接、ack/nack、心跳、慢客户端断开）
- **潜在死穴**：补发查询期间的新事件被漏掉或重复（先挂订阅并缓冲实时事件 → 补发 → 丢弃已发送 seq → 冲刷缓冲）；同一连接对同一会话重复 subscribe 时叠加订阅，导致实时事件被重复推送（必须替换旧订阅）；写库失败但已推送；慢客户端拖慢整个会话
- **完成标准**：覆盖运行中途订阅、断线重连、两个客户端同时订阅、同一连接重复订阅同一会话后每条事件只推送一次、合并后 seq 连续、写库失败不推送

#### 1.9 会话与工作区服务、REST 🟡
- **交付物**：`services/session.ts`（创建时确定账号、发送、回填 conversation id、状态更新与 `session.upserted` 广播、删除与清理、从磁盘导入）；`services/workspace.ts`；对应路由
- **完成标准**：端点与 `ApiEndpoints` 一致；运行中删除返回 `SESSION_BUSY`
- **2026-10-04 修订**（编辑重问）：`SessionService.rewindToMessage(sessionId, messageId)`，路由 `POST /api/sessions/:sessionId/messages/:messageId/rewind`。顺序：运行中返回 `SESSION_BUSY` → 会话已有 `agyConversationId` 时先取账号租约、调用 `ConversationRewindPort` 回退 agy（失败则什么都不改）→ `EventBus.truncateFrom`（先 flush，再在事务里删除 `seq >= 目标` 的事件并把 `sessions.last_seq` 置为目标 −1，同步内存中的 seq）→ 删除只出现在被删事件里的运行，`lastRunId` 改为剩余最新运行或 null → 广播 `session.reset` 与 `session.upserted`。agy 的选择列表只显示截断的一行，同文本的消息靠 `occurrenceFromEnd`（从末尾数第几个）区分；`previousMessageText`（前一条用户消息）用于事后核对。新消息由前端随后正常发送，不在此接口内
- **2026-10-04 修订**（`rewind-terminal.ts`，实测 agy 1.2.16）：agy 没有无界面回退，交互界面的 `/rewind` 列出用户消息，选中后从 agy 历史里删除该消息及之后全部轮次、还原 agy 在这些轮次里的文件改动，并把原文填回输入框。驱动用 node-pty 起 `agy --conversation <id>`，@xterm/headless 渲染屏幕后按文本解析。实测要点：① 出现 `? for shortcuts` 时 agy 还没加载完账号与模型，此时回退报 `failed to construct executor: plan model not specified`，且**这段对话从此损坏**（之后每次运行都以该错误结束），因此提示出现后还要等屏幕静止 3 秒；② 在刚确认「信任此文件夹」的同一个 agy 进程里回退必然出同样的错，所以确认信任后先退出、重开一次；③ 同一进程内不重试（重试也会损坏，且旧的报错行仍在屏幕上会误判成功）；④ 选中后要等列表关闭、原文回填、屏幕静止再退出，太早退出回退不会保存；⑤ 退出需连按 3 次 Ctrl+C（清空输入、预备退出、退出）；⑥ 回退后再开一个 agy 进程打开列表核对：最新一条应是 `previousMessageText`，或至少与回退前不同（Studio 里可能有从未送达 agy 的消息），否则报 `AGY_EXIT`。整个过程约 20–60 秒

#### 1.10 ~~Artifacts 服务与 REST~~ 🟡（已移除）
- **交付物**：`services/artifact.ts`（运行期间通过 `BrainPort` 监听主会话与子会话，300ms 防抖，变化时 version+1 并发布 `artifact.updated`）；artifacts 与子 agent transcript 路由（raw 接口用 realpath 校验必须在会话目录内，`nosniff`，svg 以附件下载）
- **完成标准**：路径穿越测试全部拒绝；运行结束后监听被释放
- **2026-10-04 移除**：Artifacts 面板整体删除，`brain-fs.ts` 中的 `listArtifacts` / `watchArtifacts` 与 `BrainPort` 对应成员一并删除。子 agent transcript 路由保留，迁到 `services/subagent-transcript.ts` 与 `routes/http/subagents.routes.ts`，行为不变：子会话归属先查运行中记录的 `subagent.spawned`（订阅 run-supervisor 事件），再回退到事件表

#### 1.11 附件服务 🟡
- **交付物**：`services/attachment/`：存储到 `<workspace>/.agy-attachments/`（自动加入 `.gitignore`）、文档转文本、prompt 注入（默认在末尾追加 `<images_input>` / `<files_input>` 路径列表；`profile.stream.imageInput.supported` 为 true 时改用原生格式）；attachments 路由
- **完成标准**：恶意文件名不会写到附件目录外；注入结果有快照测试

#### 1.12 ~~检查点（影子 git）~~ 🔴（已移除）
- **交付物**：`services/checkpoint.ts`（影子仓库 `DATA_DIR/shadow/<workspaceId>.git`，所有命令带 `--git-dir` 与 `--work-tree`；运行前快照，超时 15 秒则跳过；diff；回滚前再做一次快照；同一工作区的操作串行化）；checkpoints 路由
- **潜在死穴**：回滚覆盖用户后来的手动修改；大仓库首次快照阻塞运行；并发快照互相干扰；误操作用户自己的 `.git`
- **完成标准**：新增、修改、删除文件后回滚正确；测试前后用户 `.git` 目录哈希一致
- **2026-10-04 修订**（实测后修复"检查点永久失效"）：
  - **问题**：实现的快照默认超时为 3 秒（`defaultTimeoutMs`，与上文设计的 15 秒不一致，待定），超时后通过 `AbortSignal` 杀掉正在运行的 git。本机实测首次快照：300 个文件 4.9 秒，3000 个文件 28.6 秒（增量快照约 1 秒）。被杀的 `git add -A` 会在影子仓库留下 `index.lock`，之后每次快照都因锁文件失败，只记一条 error 日志，界面无提示，检查点实际上一个都没有
  - **修复**：超时只阻止开始下一步，**绝不杀正在运行的 git**（`execGit` 不再把信号交给子进程，已超时则不启动新步骤）；`snapshot` 到时即返回 `null`，不阻塞运行，计时包含排队等锁的时间；准备步骤与 `add -A` 在锁内总是跑完（只写影子仓库），为后续快照预热索引；`commit` 及记录检查点受超时控制，超时后才完成的快照不入库（此时运行可能已改动工作区）；`ensureRepoInitialized` 在锁内清理残留的 `index.lock`（锁内不可能有其他 git 在用，残留一定来自崩溃或旧版本）；新增 `whenIdle()` 等待后台收尾
  - **回滚**：一旦开始改写工作区（`read-tree` → `checkout-index` → `clean -fd` → `update-ref`）就不再响应超时，保证全部完成，避免工作区停在一半新一半旧的状态；`diff` 的 `reset HEAD` 清理步骤总是执行
  - **效果**（默认 3 秒，两次运行之间有间隔）：300 个文件从第 2 次运行起有检查点，3000 个文件从第 3 次起；修复前永远没有。是否把默认值调到设计的 15 秒（首次运行最多多等 15 秒）尚未决定
- **2026-10-04 移除**：上述修复合并后，按产品决定删除整个检查点功能（服务、路由、仓库、前端 Changes 标签与 DiffViewer）。数据库第 2 版迁移 `drop_checkpoints` 删除 `checkpoints` 表、`runs.checkpoint_id` 列与 `checkpointsEnabled` 偏好（第 1 版不改，已有数据库都已执行过它）。`DATA_DIR/shadow/` 下已有的影子仓库不会自动删除，可手动清理

#### 1.13 模型、偏好、系统接口 🟢
- **交付物**：`integrations/agy/catalog.ts`（按 profile 执行版本与模型命令并解析）；`services/model.ts`（缓存 10 分钟）、`services/prefs.ts`；system 路由（capabilities 的 features 来自 profile；比较 agy 版本与 profile 版本）
- **完成标准**：agy 未安装时 capabilities 返回 `agyPath: null`，不会报 500
- **2026-10-03 修订**：`agy models` 返回「Please sign in」时映射为 `AGY_NOT_AUTHENTICATED`；列模型前尽量从默认账号快照恢复 live 凭据；成功列表写入 `DATA_DIR/models-cache.json`，CLI 失败时回退缓存。若缓存文件尚不存在，启动时用 `fixtures/agy/catalog/models.txt`（本机探测结果）种子一份，避免空列表把账号/模型显示成「未登录」。有效磁盘缓存命中时不再每次恢复凭据并打 CLI。输入栏模型选择器在失败后把原因放到 title，仍显示上次选中的模型 id
- **2026-10-04 修订**：`catalog.ts` 执行 agy 时原来在 Windows 上无条件 `shell: true`，命令行拼接不转义，agy 路径含空格（如用户名 `John Smith`）时被截断，模型列表报 `AGY_NOT_INSTALLED`、版本检测返回 null。改为只有 `.cmd`/`.bat` 才走 shell，且路径加引号；`.exe` 直接执行。agy 1.2.16 把 `Fetching available models...` 从 stdout 移到了 stderr，解析器本来就跳过该行，不受影响

#### 1.14 凭据快照与账号服务 🔴
- **前置证据**：VERIFY.md 的 V7（凭据条目名、编码格式、相关文件）必须有本机探测结论，没有就停下
- **交付物**：`integrations/agy/credential-store.ts` + `dpapi.ts`（按 profile 的条目模式与文件列表做快照、恢复、清空；快照用 DPAPI 加密落盘）；`services/account/account.ts`（账号库、默认账号、§2.6 的租约与切换逻辑、`account.changed` 广播）、`lease-lock.ts`（基于 `utils/rw-lock`，全局一把锁）
- **潜在死穴**：
  - `credential_snapshot` 切换写到一半失败，live 槽位留下残缺凭据 → 先备份当前 live，任一步失败就恢复
  - 运行中的 agy 刷新 token 后写回 live 槽位，覆盖刚切换的账号 → 有读锁时绝不允许写锁
  - 运行结束时把 live 槽位的新 token 同步回对应账号的快照，否则快照里的 token 会过期
  - 凭据出现在日志或 API 响应中
- **完成标准**：锁的并发测试；模拟写入失败能恢复；日志中搜不到凭据内容

#### 1.15 终端窗口登录 🟡
- **前置证据**：VERIFY.md 的 V10（登录完成后 live 凭据的变化）
- **交付物**：`integrations/agy/login-terminal.ts`（实现 `LoginPort`：用 `profile.login.argv` 在一个新的系统终端窗口中启动 agy，由用户自己完成登录；服务端不读取、不解析终端输出）；在 `account.ts` 中编排登录：持写锁 → 备份 live → 清空 → 弹出终端（状态 `awaiting_browser`，`authUrl` 为 null）→ 每 2 秒检查 live 凭据是否出现（判定方式以 V10 为准）→ 快照为新账号 → 按用户选择恢复原账号或切到新账号；10 分钟超时自动取消
- **潜在死穴**：登录中途用户关闭页面、关掉终端或超时，live 槽位处于被清空状态 → 任何结束路径（成功、取消、超时、服务关闭）都必须在同一个 finally 中恢复；凭据刚写入一半就被快照 → 检测到凭据后再等 2 秒、两次读取一致才快照
- **完成标准**：用可注入的假终端启动器和假凭据存储覆盖成功、取消、超时、服务关闭四条路径；每条路径结束后 live 凭据状态正确，写锁已释放
- **2026-10-03 修订**（登录网络预检）：实测登录失败的原因是浏览器授权成功后，agy 向 `oauth2.googleapis.com/token` 换令牌时直连超时——agy 是 Go 程序，只认 `HTTPS_PROXY` 等环境变量，不读 Windows 系统代理（见 1.18 修订）。`AccountService` 新增可选 `loginPreflight`，在备份与清空 live 凭据**之前**执行；`app.ts` 只在使用真实登录终端时接入 `utils/connectivity.ts` 的 `assertGoogleAuthReachable`：用系统自带 `curl`（与 agy 一样只认环境变量代理）访问该地址，任何 HTTP 响应即视为可达；不可达时立即返回 `AGY_TIMEOUT`（可重试），消息说明原因（超时、DNS、证书等）以及当前是直连还是走哪个代理，不再让用户等满 10 分钟。找不到 `curl` 时跳过预检；`AGY_STUDIO_SKIP_NET_CHECK=1` 可关闭
- **2026-10-04 修订**：`defaultTerminalLauncher` 的 `cmd /c start "" <command>` 使用 `windowsVerbatimArguments`，原来命令路径没加引号，agy 路径含空格时 `start` 找不到被截断的路径并弹出系统报错框，登录窗口打不开。拼参数提取为 `buildWindowsStartArgs`：命令总是加引号，参数仅在含空白或引号时加引号

#### 1.16 ~~statusline 桥接与接收~~（已取消）
额度改为由 1.17 直接查询额度接口，不再需要 statusline 桥接。

#### 1.17 额度接口与缓存 🔴
- **前置证据**：VERIFY.md 的 V7（refresh token 在哪）与 V12（额度接口请求与响应格式，脱敏后存入 `fixtures/agy/quota/`）
- **交付物**：`integrations/agy/oauth-client.ts`（从 agy 程序中读取 OAuth 客户端标识，只保存在内存）；`quota-api.ts`（实现 `QuotaProbePort`：读取 live 凭据中的 refresh token → 换取 access token（内存缓存，过期前复用）→ 调用额度接口 → 解析成 `QuotaSnapshot`）；`services/quota.ts`（按账号缓存并写入 `quota_cache`、每账号 1 分钟限流、同时到达的请求合并为一次、失败时返回旧数据并标 `stale`、从未成功则 `source='unavailable'`、`account.changed` 时作废缓存、`quota.updated` 广播）
- **潜在死穴**：token 或客户端标识出现在日志、错误信息、数据库或 API 响应中；接口结构变化导致解析出错误数据 → 解析失败就整体放弃，不输出部分结果；查询返回时账号已切换 → 按账号名缓存，丢弃与请求账号不一致的结果；查询期间与切换账号竞争 → 读取 live 凭据时持读锁
- **完成标准**：解析器对脱敏 fixtures 做快照测试；限流、合并、stale、unavailable、切换作废都有测试；测试日志中搜不到 token
- **2026-10-03 修订**：额度探测超时改为 20 秒，`loadCodeAssist` 单独 5 秒以免串行吃满两次超时；从未成功时 `unavailable.description` 写入超时/未登录原因，面板展示该说明而不是只显示问号。启动入口若检测到 `HTTPS_PROXY`/`HTTP_PROXY` 且未设置 `NODE_USE_ENV_PROXY`，会带该标志重拉进程，让 Node fetch 走代理（否则访问 Google 额度接口会一直超时）

#### 1.18 后端装配与启动 🟡
- **交付物**：`app.ts`（手写构造注入：先创建 integrations 实现，再注入 services，最后注册路由）；`main.ts`（配置 → 迁移 → 加载 profile → 清理孤儿进程 → 监听）；生产模式静态托管前端；优雅关闭
- **完成标准**：以 fake-agy 启动，用 ws 客户端走通"创建工作区 → 创建会话 → 发送 → 收到完整事件"；`services/` 下没有任何文件 import `integrations/`（加一条 ESLint 规则强制）
- **2026-10-03 修订**（自动沿用系统代理）：客户既有用代理的也有直连的，不能写死。`utils/proxy.ts` 的 `applySystemProxyToEnv` 在 `main.ts` 入口、`NODE_USE_ENV_PROXY` 重拉进程**之前**执行，结果写入 `process.env`，agy 登录终端与所有运行进程自动继承。规则：已设置 `HTTPS_PROXY`/`HTTP_PROXY` → 尊重用户设置不改动；未设置且 Windows 系统代理开启（读 `HKCU\...\Internet Settings` 的 `ProxyEnable`/`ProxyServer`/`ProxyOverride`）→ 先 TCP 探测代理端口（防止代理软件已退出但注册表残留），可连通才写入，并把 `localhost,127.0.0.1,::1` 与 `ProxyOverride` 合并进 `NO_PROXY`；未开代理 → 不做任何事，直连。PAC 脚本与仅 SOCKS 的配置无法自动识别，只记警告。`AGY_STUDIO_PROXY=off` 关闭自动识别。仅支持 Windows，macOS/Linux 需自行设置 `HTTPS_PROXY`

#### 2.1–2.13 前端模块

| 模块 | 交付物要点 |
|---|---|
| 2.1 🟢 骨架与主题 | Vite + React + Tailwind + shadcn；Antigravity 风格深色主题变量；两栏布局壳（原三栏，右栏 Artifacts 已于 2026-10-04 移除）；开发代理 `/api`、`/ws` |
| 2.2 🟡 HTTP 客户端 | 按 `ApiEndpoints` 推导类型的 `request()`；错误解析为 `ApiError`；带进度的附件上传 |
| 2.3 🔴 WS 客户端 | 心跳、指数退避加抖动、按 lastSeq 自动重订、跳号重订、重复丢弃、离线排队、ack 超时 |
| 2.4 🟡 时间线 reducer | 事件 → 时间线条目的纯函数；思考计时；工具合并与折叠；子 agent 挂载；运行分隔条 |
| 2.5 🟡 stores | 会话槽位（先 REST 拉历史再 WS 订阅）；全局事件统一分发 |
| 2.6 🟢 时间线原子组件 | 思考块、各类工具卡片、终端输出、Markdown、分隔条、错误与卡死提示；开发用 Playground 页 |
| 2.7 🟡 子 agent 卡片 | 运行中实时追加；结束后首次展开懒加载；步骤过多时截断 |
| 2.8 🟡 输入框与附件 | 输入法组字处理、粘贴与拖拽、手机拍照、图片压缩、上传进度、运行中停止、草稿保存 |
| 2.9 🟢 收件箱、工作区与新建会话 | 按状态分组的会话列表；工作区切换与添加；新建会话直接使用当前账号 |
| 2.10 🟡 ~~Artifacts 面板~~ | 已移除（2026-10-04） |
| 2.11 🟢 额度与账号 | 顶栏额度环；额度面板（分组、桶、倒计时、置灰、过期提示、不可用提示、刷新）；账号菜单与管理页（各账号运行数、终端窗口登录流程） |
| 2.12 🟡 ~~检查点界面~~ | 已移除（2026-10-04） |
| 2.13 🟡 对话视图组装 | 虚拟滚动、动态行高、自动跟随与"回到底部"、断线提示条 |

- **2026-10-01 修订（2.1 主题）**：新增浅色主题。`theme.css` 的 `:root` 为深色，`:root[data-theme='light']` 覆盖同名变量；`tailwind.config.js` 的语义颜色经 `color-mix` 支持透明度修饰（Tailwind 3 不能直接给 `var()` 加透明度，原先的 `bg-accent/20` 等类不会生成）。偏好（浅色 / 深色 / 跟随系统）只是界面偏好，存 localStorage 的 `agy-studio-theme`，不进 prefs 契约；`index.html` 内联脚本在首帧前设置 `data-theme` 防闪烁；顶栏 `ThemeToggle` 切换；Shiki 同时加载 `github-light` 与 `tokyo-night`，深色时用 `--shiki-dark`。组件**不得**再写 Tailwind 色板色（`emerald-400`、`rose-500/10` 等）和十六进制颜色，状态色一律用 `status-{success|warning|error|info}`、`-subtle`、`-text`，代码背景用 `bg-bg-code`；遮罩层的 `bg-black/*` 除外
- **2026-10-01 修订（2.4 展示投影）**：reducer 不变（仍按步骤产出条目）。新增 `domain/displayRows.ts` 的纯函数 `buildDisplayRows(items, { activeRunId, thinkingHidden })`，把条目投影为展示行：用户消息、助手消息（旁白与最终回复，始终平铺可见）、运行分隔、错误、卡死提示各占一行；两条消息之间同一 run 的连续工作（工具——`tool_group` 先拆平——、思考、子 agent）合成一个 Worked 行，时长从首个步骤开始到下一条消息（运行中的末尾块无终点、实时计时）；Worked 内相邻同类工具（`domain/toolLabels.ts` 的类别：command / edit / view / explore / browser / mcp / subagent / other）合并计数为一组，"Ran 2 commands"；助手身份每个 run 只在第一行显示
- **2026-10-01 修订（2.6 / 2.13 行组件）**：对话视图不再一条步骤一个卡片，改用 `components/timeline/rows/` 的无状态行组件：`WorkedBlock`（"Worked for 42s ›"，运行中自动展开，显示 "Working… Xs"）、`ToolGroupRow`、`ToolRow`（"Ran <命令>"、"Edited <图标> 文件名 +N −M"、"Viewed …"、"Explored …"，增删行数仅在后端给出时显示）、`ToolDetail`（点开后的命令输出、diff 或工具输出）、`ThinkingRow`、`UserMessageRow`、`AssistantMessageRow`；三级展开（Worked → 分组 → 单个工具）的用户选择仍保存在 ManagerView，键为 Worked key、`group-<首个 toolCallId>`、toolCallId 或思考 id。子 agent 卡片由 ManagerView 通过 `renderSubagent` 传入，行组件不 import store / api。原有卡片组件保留给 Playground 与子 agent 嵌套时间线使用
- **2026-10-03 修订（2.13）**：去掉对话视图顶部「agy 已升级，建议重新探测」横幅。CLI 与 profile 版本仍写在 capabilities 里，界面不再提示
- **2026-10-03 修订（2.8）**：对话输入栏不再展示 Effort、Mode、Agent。日常使用固定走会话/后端默认；契约里的 `effort`/`mode`/`agent` 字段保留，Playground 仍可单独渲染这些选择器。模型只在输入栏选择，并写回 prefs.defaultModel；顶栏不再放模型选择器。模型列表拉取失败时显示未登录等原因，空列表且已结束请求时不再一直显示「加载模型中」
- **2026-10-03 修订（2.6）**：助手回复右上角提供「复制」整段内容；Markdown 代码块复制按钮改为中文；连续的框线字符（┌│└ 等）拆成可单独复制的引用块
- **2026-10-04 修订（2.4 / 2.6 编辑重问）**：`UserMessageRow` 悬停显示「编辑」，点开后原地变成输入框（Enter 发送、Shift+Enter 换行、Esc 取消，输入法组字中不触发），并提示之后的回答会全部删除、agy 改过的文件会还原；运行中按钮禁用并说明原因。行组件只接收 `onEdit` / `editDisabledReason`，由 ManagerView 接线。`session.store.editMessage`：调用回退接口 → 清空该会话槽位并重新加载 → 用当前模型和原附件发送新内容；回退成功但发送失败时抛 `EditResendError`，ManagerView 显示横幅并保留改后的文字。`bootstrap` 收到全局 `session.reset` 时对已打开的会话执行槽位重置
- **2026-10-03 修订（2.11）**：额度面板把接口英文标签译成中文（来源、套餐档、分组名、桶名），界面文案全部中文。探测失败时展示 `description`（超时、未登录）而不是只显示问号

#### 3.1 端到端测试 🟡 / 3.2 启动脚本与 README 🟢
- 3.1：Playwright + fake-agy，覆盖发送与流式显示、子 agent、中止、刷新后历史完整、断网重连、附件、登录流程
- 3.2：`start.cmd`（检查 Node 与 agy → 按需构建 → 启动 → 打开浏览器）；README（安装、首次登录、局域网访问安全、自动同意风险（建议自行 git 提交）、"agy 升级后重新探测"的步骤）
- **2026-10-03 修订（3.2）**：`start.cmd` 原为 LF 换行且含 UTF-8 中文，中文 Windows（GBK 代码页）下 cmd 按字节偏移解析会把中文切断成乱码命令（`此时不应有 )`），双击后窗口一闪即退；只改 CRLF 仍会在全角标点处报错。现改为**纯 ASCII + CRLF**，提示文字为英文，文件头注释写明这一约束；同时修复后台等端口打开浏览器那行的嵌套双引号（改用 `start "" /b powershell ...`），并在开头 `cd /d "%~dp0"`。编辑此文件时不要引入非 ASCII 字符

---

## 阶段 5 · 派工单（可直接复制给 Gemini / Sonnet）

使用方法：每次只复制**一个**模块的 Prompt。🔴 模块完成后，把改动和本文档对应章节交给 Opus 复审，通过后再提交。

每段 Prompt 都包含这些固定约束：只实现本模块、只改列出的文件；类型从 `@agy-studio/contracts` 导入，**禁止修改 `contracts/`**（不够用就停下说明）；前后端不能互相 import；**不得参考或复制任何第三方 agy 包装项目的代码**；agy 相关的路径、格式、命令只能从 `agy-profile.json` 读取。

### 派工 0.1 🟢

```text
你是执行工程师。仓库根目录已有 contracts/（共享 TS 契约）和 docs/ARCHITECTURE.md。
任务：实现模块 0.1「Monorepo 骨架与工具链」，目录结构见 ARCHITECTURE.md §3.1，技术选型见 §3.2。
要做：
1. 根 package.json（npm workspaces: contracts, backend, frontend, tools/*），脚本 dev/build/test/typecheck/lint
2. tsconfig.base.json（strict, ES2022, ESM），各 package 的 tsconfig extends 它
3. backend/：Fastify + TS 空应用，临时的 GET /api/health 返回 {ok:true}；vitest
4. frontend/：Vite + React + TS + Tailwind 空应用；vitest
5. ESLint + Prettier；ESLint 规则：backend/src/services/** 禁止 import backend/src/integrations/**
6. .gitignore：node_modules, dist, *.db, .agy-studio/, fixtures/private/
约束：不要修改 contracts/src；不要写业务逻辑。
验收：npm install && npm run typecheck && npm run build && npm test 通过；前后端各有一行 import type { Session } from '@agy-studio/contracts' 能通过类型检查。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 0.1 Monorepo 骨架与工具链"
```

### 派工 0.2 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md「设计原则」和阶段 0 探测清单中的 V1–V4、模块 0.2。
知识来源只能是 Antigravity 官方文档（https://antigravity.google/docs）和实际录制结果，不得参考任何第三方 agy 包装项目。
任务：编写 tools/discover/record-stream.ts，录制真实 agy 的 stream-json 输出。
要求：
1. 参数：--scenario --prompt [--cwd] [--model] [--turns <文件，每行一轮>] [--abort-after-ms] [--extra-args]
2. 按官方文档的参数启动 agy 的 stream-json 输入输出模式，并带上 --dangerously-skip-permissions；user 帧格式先按官方文档，另外提供 --frame-template 参数以便手动尝试其他格式
3. 保存每行 stdout（附相对毫秒时间戳）到 fixtures/agy/stream/<scenario>/stdout.jsonl，stderr 到 stderr.txt，meta.json 记录版本、参数、退出码、耗时
4. 保存前脱敏：邮箱、疑似 token 的长字符串、用户主目录路径
5. 写 tools/discover/README.md：列出 9 个场景的命令（纯对话、读写文件、执行命令、子 agent、额度耗尽、带图片路径、中途中止、多轮 stdin、访问工作区外路径），以及每个场景要观察什么
6. 创建 docs/VERIFY.md 模板：V1–V11 每项包含「结论 / 证据文件 / 对实现的影响」三栏，本模块填写 V1–V4 的观察要点
约束：只新增 tools/discover/record-stream.ts、tools/discover/README.md、docs/VERIFY.md。
验收：没有安装 agy 时给出清晰的报错；类型检查通过。
完成后提示我手动运行这 9 个场景并补全 VERIFY.md，然后执行：git add . && git commit -m "feat: 完成模块 0.2 stream 录制"
```

### 派工 0.3 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md「设计原则」、§2.4 profile 结构、阶段 0 探测清单 V5–V11、模块 0.3。
知识来源只能是官方文档和实际探测结果。
任务：在 tools/discover/ 下编写环境探测脚本：
1. fs-diff.ts：对 %USERPROFILE%、%APPDATA%、%LOCALAPPDATA% 做文件快照（路径、大小、修改时间），运行指定命令后再快照，输出新增、修改、删除的列表（排除浏览器缓存等噪音目录，可配置）
2. cred-diff.ts：执行 cmdkey /list 前后对比，输出新增或变化的凭据条目名称（只输出名称，绝不输出内容）
3. quota-probe.ts：用本机已登录账号调用一次额度接口，只保存响应的字段结构（token、邮箱、项目 ID 全部替换为占位符）
4. （已取消：isolation-test、statusline-capture、pty-record）
5. （同上）
6. catalog-probe.ts：记录 agy --version、模型列表命令的原始输出、mode 可选值
7. 所有会修改 settings 或凭据的脚本：运行前备份，结束（包括异常退出）时恢复
8. 产出放到 fixtures/agy/{fs,quota,catalog}/，全部脱敏
9. 根据结果生成 backend/agy-profile.draft.json（字段参照 ARCHITECTURE.md §2.4，不确定的字段填 null 并在 VERIFY.md 中说明）
10. 在 tools/discover/README.md 中补充每个脚本的使用顺序
约束：只改 tools/discover/、fixtures/agy/ 的 README 占位、docs/VERIFY.md、backend/agy-profile.draft.json。
验收：每个脚本在参数缺失时给出用法说明；备份与恢复逻辑有单元测试。
完成后提示我手动运行探测并补全 VERIFY.md 的 V5–V11，然后执行：git add . && git commit -m "feat: 完成模块 0.3 环境探测"
```

### 派工 0.4 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 0.4、backend/agy-profile.draft.json，以及 fixtures/agy/ 下的录制格式。
任务：实现 tools/fake-agy/，一个可以替代真实 agy 的回放器。
要求：
1. 可执行入口（Windows 提供 .cmd 包装），接受 profile 中记录的参数形式
2. 环境变量：FAKE_AGY_SCENARIO 选择 stream 场景，FAKE_AGY_SPEED 回放倍速（0 表示不等待），FAKE_AGY_HOME 数据根目录
3. stream 模式：按时间戳回放 stdout；把 transcript 按 profile.paths 的规则写到 FAKE_AGY_HOME 下；回放完 result 后与真实 agy 一样，等 stdin 关闭才以 0 退出
4. （已取消：交互模式与伪终端回放）
5. 收到 SIGTERM / SIGINT 立即退出
约束：只新增 tools/fake-agy/。
验收：vitest 覆盖 stream 回放、倍速 0 的耗时、stdin 不关闭时不退出、SIGTERM 退出。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 0.4 fake-agy 回放器"
```

### 派工 1.1 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.2、模块 1.1，contracts/src/errors.ts。
任务：实现 backend/src/utils/ 下的 config、logger、errors、proc-tree、jsonl-tail、backoff、rw-lock、ids。
要点：
- config：HOST（默认 127.0.0.1）、PORT（默认 8790）、AGY_STUDIO_TOKEN、AGY_BIN、DATA_DIR（默认 ~/.agy-studio）；HOST 非回环且无 token 时抛错
- logger：pino，字段名包含 token、secret、password、credential、authorization、cookie、apiKey 的值替换为 [REDACTED]
- errors：class AppError extends Error { code: ErrorCode; retryable; details? }，提供 toApiError()
- proc-tree：killTree(pid)，Windows 用 taskkill /T /F，其他平台 SIGTERM 后 2 秒 SIGKILL；进程确认退出后 resolve
- jsonl-tail：class JsonlTail(path, offset)，read() 返回新增完整行和新偏移；处理半行、文件不存在、截断
- backoff：nextDelay(attempt, baseMs, maxMs)，带抖动
- rw-lock：tryRead() / tryWrite() 立即返回租约或 null（不排队）；有写锁或写锁正在等待时 tryRead 返回 null；有任何读锁时 tryWrite 返回 null；租约 release() 幂等；提供 readers 计数
约束：只改 backend/src/utils/ 和 backend/test/utils/；不要修改 contracts/。
验收：每个文件都有 vitest；rw-lock 覆盖并发与重复释放。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.1 后端工具层"
```

### 派工 1.2 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.9、模块 1.2，contracts/src/domain.ts、events.ts。
任务：实现 backend/src/repositories/：db、migrations，以及 workspaces、sessions、runs、events、attachments、accounts、quota-cache、prefs。
要点：
- better-sqlite3，WAL，busy_timeout 5000；数据库文件 DATA_DIR/studio.db
- 迁移按版本号执行并记录在 schema_migrations
- repo 入参和返回值使用契约类型；列名 snake_case，repo 内部转换
- events：appendBatch(sessionId, envelopes) 在事务内写入并更新 sessions.last_seq；listAfter(sessionId, afterSeq, limit)；latestSeq(sessionId)
- runs：listNonTerminal()
- accounts 表绝不包含凭据字段
约束：只改 backend/src/repositories/ 和对应测试；不要修改 contracts/。
验收：每个 repo 都有基于临时数据库文件的集成测试。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.2 数据层"
```

### 派工 1.3 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 设计原则 3–4、§2.3 端口表、§2.4 profile 结构、模块 1.3，以及 backend/agy-profile.draft.json 和 docs/VERIFY.md。
任务：
1. backend/src/integrations/agy/profile/schema.ts：用 zod 定义完整的 AgyProfile schema（字段见 §2.4，按 VERIFY.md 的实际结论细化；模板类字段用带占位符的字符串或 JSON 对象）
2. backend/src/integrations/agy/profile/loader.ts：loadProfile(path) 读取并校验，失败时抛出包含全部错误字段路径的 AppError
3. 把 agy-profile.draft.json 补全后另存为 backend/agy-profile.json（无法确定的字段按降级方案填写，并在文件旁的 agy-profile.notes.md 中说明）
4. backend/src/services/ports/ 下为 §2.3 的每个端口写一个 *.port.ts：只包含 TypeScript 接口与相关类型，类型尽量复用 @agy-studio/contracts
约束：只改上述文件；端口文件不得包含实现代码，也不得 import integrations/；不要修改 contracts/。
验收：loader 对 agy-profile.json 校验通过；对缺字段、类型错误的样例给出精确路径；类型检查通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.3 profile schema 与端口定义"
```

### 派工 1.4 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §1.3 事件不变量、模块 1.4，contracts/src/events.ts 的 AgentEvent，backend/agy-profile.json 的 stream 部分，docs/VERIFY.md 的 V1–V4，以及 fixtures/agy/stream/*/stdout.jsonl。
不得参考任何第三方 agy 包装项目，事件格式只以 fixtures 与官方文档为准。
任务：实现 backend/src/integrations/agy/stream-schema.ts 与 stream-adapter.ts。
要点：
- stream-schema：为 fixtures 中出现的每种原始事件写 zod schema（passthrough 未知字段）
- stream-adapter：纯函数 adapt(line: unknown, ctx: {runId; nextId(): string; now(): string; profile}) => { events: AgentEvent[]; conversationId?: string; usage?: TokenUsage; terminal?: {status; error} }
  · 事件类型到 AgentEvent 的对应关系读取 profile.stream.eventTypeMap
  · 工具名映射到 ToolKind（映射表放在适配器内的常量里，并允许 profile 覆盖）
  · 编辑、写入类工具从参数中提取 FileChange
  · 派生子 agent 的工具额外产出 subagent.spawned
  · 最终结果只通过 terminal 与 usage 返回，run.completed 由 supervisor 负责发出
  · schema 校验失败或未知类型 → raw
  · 识别 profile.stream.permissionEvent，返回 permissionRequest 标记（供 runner 自动回复）
约束：只改这两个文件和对应测试；适配器不能有副作用；不要修改 contracts/。
验收：每个 fixture 的快照测试；未知行产出 raw 且不抛异常。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.4 stream schema 与适配器"
```

### 派工 1.5 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 1.5、backend/src/services/ports/brain.port.ts、backend/agy-profile.json 的 paths 部分、docs/VERIFY.md 的 V3、V5，以及 fixtures/agy/fs/。
任务：实现 backend/src/integrations/agy/brain-fs.ts 与 transcript.ts，二者共同实现 BrainPort。
要点：
- 所有路径从 profile.paths 计算
- listConversations(dataRoot)：返回 id、标题（取首条用户输入的前 50 字符）、创建与更新时间
- transcript：parseLine(line) => TranscriptStep | null；tail(conversationId, {fromStep}) 返回 AsyncIterable<TranscriptStep>，文件不存在时每 300ms 轮询，使用 utils/jsonl-tail，按 stepIndex 去重，stop() 释放全部资源
- toEvents(step, role: 'main'|'subagent', conversationId)：主会话含思考 → thinking.delta(source='transcript')；子会话 → subagent.step
- purgeConversation(dataRoot, id)：只允许 UUID 格式的 id，只删除 conversationDirPattern 解析出的路径；realpath 校验必须在数据根内；拒绝符号链接
约束：只改这两个文件和对应测试；不要修改 contracts/。
验收：追踪用临时文件逐行追加测试；stop() 后无残留定时器；清理函数的路径安全测试。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.5 agy 数据目录与 transcript"
```

### 派工 1.6 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6 租约、§2.8 状态机、§1.3 事件不变量、模块 1.6 的全部潜在死穴，以及 services/ports/agy-runner.port.ts、backend/agy-profile.json 的 stream 部分、docs/VERIFY.md 的 V1。
任务：实现 backend/src/integrations/agy/process.ts（AgyRunnerPort）和 backend/src/services/run-supervisor.ts。
要点：
- process.ts：start({bin, argv, cwd, env}) 返回 {pid, send(text, images?), events: AsyncIterable<适配器输出>, kill(), exited}；spawn 不用 shell、windowsHide；user 帧按 profile.stream.userFrameTemplate 生成；stdout 按行切分交给 1.4 的适配器；close 时冲刷最后半行；适配器返回 permissionRequest 时按 profile.stream.permissionEvent.replyTemplate 立即回复，并额外产出 autoapprove.injected(layer='permission_event')；kill() 用 utils/proc-tree
- argv 固定包含 profile 中的 stream 输入输出参数和 --dangerously-skip-permissions，以及 model / effort / mode / 续聊参数
- run-supervisor.ts：
  · start(sessionId, input)：同会话互斥（SESSION_BUSY）、并发上限（CONCURRENCY_LIMIT）、申请账号读锁（失败返回 ACCOUNT_SWITCH_IN_PROGRESS）；检查与状态写入在同一段同步代码中
  · 账号租约通过注入的 acquireLease(accountName) 获取，并从租约拿到要注入的环境变量
  · 发出 run.started；转发适配器事件；只完成一次守卫覆盖 close、error、abort、超时四条路径，保证恰好一条 run.completed，并在同一处释放租约
  · 监听器异常要捕获并记录
  · abort(runId)、activeRuns()、hasActiveRuns(accountName?)
  · reapOrphans()：终止 runs 表中非终止运行的 pid 进程树并标记 failed
  · profile.stream.multiTurnStdin 为 false 时，每轮消息新起进程并带续聊参数
约束：只改上述两个文件和对应测试；依赖通过构造函数注入；不要修改 contracts/。
验收：AGY_BIN=fake-agy 测试正常、非零退出、中止、超时、并发上限、双击发送、租约获取失败；每种情况恰好一条 run.completed、租约计数归零、无残留子进程。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 1.6"，并列出你认为最可能出现竞态的地方。
复审通过后执行：git add . && git commit -m "feat: 完成模块 1.6 进程与 RunSupervisor"
```

### 派工 1.7 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 1.7 的四层设计与潜在死穴、services/ports/settings.port.ts、backend/agy-profile.json 的 settings 部分、docs/VERIFY.md 的 V2、V6。
任务：
1. backend/src/integrations/agy/settings.ts：实现 SettingsPort.ensureAlwaysProceed(scope: 'global'|'workspace', opts: {workspacePath?; homeDir?})：按 profile.settings.files 计算路径（homeDir 为预留参数，当前总是使用默认用户目录），读取 → 按 alwaysProceed.jsonPath 设置值 → 写临时文件 → rename；保留其他全部字段；文件不存在时创建；写失败重试一次，仍失败则返回警告而不是抛错
2. backend/src/services/autoapprove/autoapprove.ts：运行开始前对全局（及账号 home）和工作区调用 ensureAlwaysProceed；有警告时发布 autoapprove.injected(layer='settings', detail=警告内容)
3. backend/src/services/autoapprove/watchdog.ts：每个运行一个实例；stallTimeoutSeconds 无输出 → 发布 run.stalled；有 kind 为 run_command 的工具处于 running 时超时放宽 3 倍；进入 stalled 后通过 runner.send 注入一次 profile 中的同意回复并发布 autoapprove.injected(layer='watchdog')；再过一个周期仍无输出 → 以 AGY_STALLED 终止运行
4. 在 run-supervisor.ts 中加入最少的接入代码
约束：只改上述文件和对应测试；不要修改 contracts/。
验收：settings 写入前后其他字段逐字节一致（JSON 格式化方式也保持原样：检测原文件的缩进）；fake-agy 构造"输出停止"场景验证完整链路。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 1.7"。
复审通过后执行：git add . && git commit -m "feat: 完成模块 1.7 自动同意四层兜底"
```

### 派工 1.8 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §1.2、§1.3、模块 1.8 潜在死穴，contracts/src/ws.ts、events.ts。
任务：实现 backend/src/services/event-bus.ts 和 backend/src/routes/ws/gateway.ts。
要点：
- event-bus：publish(sessionId, runId, event)：每会话串行队列、连续 seq（从 events repo 的 latestSeq 继续）；同一 messageId 的 message.delta 或同一 blockId 的 thinking.delta 在 WS_LIMITS.deltaCoalesceMs 内合并；每 50ms 或 100 条调用 appendBatch，写库成功后才推送；subscribe / unsubscribe；publishGlobal(event)
- gateway：config 有 token 时校验 ?token=；session.subscribe 流程：挂订阅并缓冲实时事件 → 按 replayBatchSize 分批补发 seq > lastSeq → 丢弃缓冲中 seq ≤ 已发最大值的事件 → 冲刷缓冲 → 直接推送 → 发送 subscribed{latestSeq, activeRunId}；同一 socket 对已订阅的会话再次 subscribe 时，先撤掉旧订阅（包括未冲刷的缓冲）再按上述流程重来，任何时刻每个 socket 对每个会话最多一份订阅；session.send / run.abort 调用注入的 sessionService 并回 ack / nack；heartbeatIntervalMs 两个周期未收到 ping 则断开；单 socket 待发送超过 8MB 则断开
约束：只改这两个文件和对应测试；sessionService 用最小接口注入；不要修改 contracts/。
验收：覆盖运行中途订阅、断线重连、双客户端、同一 socket 重复订阅同一会话后每条事件只收到一次、合并后 seq 连续、写库失败不推送。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 1.8"，重点说明补发与实时衔接的实现。
复审通过后执行：git add . && git commit -m "feat: 完成模块 1.8 EventBus 与 WS 网关"
```

### 派工 1.9 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6、模块 1.9，contracts/src/api.ts 中 workspaces 与 sessions 端点，services/ports/brain.port.ts。
任务：实现 backend/src/services/session.ts、workspace.ts 与 routes/http/{workspaces,sessions}.routes.ts。
要点：
- 创建会话：accountName 置 null；运行开始时由 run-supervisor 写入当时的 live 账号（仅用于展示）
- send(sessionId, {text, attachmentIds, model?, effort?, mode?})：发布 user.message（附件对象从 repo 查出）→ supervisor.start（带上会话绑定的账号）→ 返回 runId；实现 1.8 中定义的 sessionService 接口
- 监听 supervisor：首次拿到 conversationId 时回填；运行开始与结束时更新状态并 publishGlobal(session.upserted)
- 标题默认取首条消息前 50 字符
- DELETE：运行中返回 SESSION_BUSY；purge=true 时通过 BrainPort.purgeConversation 清理（包括子会话）
- import：通过 BrainPort 列出数据根中未导入的会话，把 transcript 转成事件写入，source='imported'，accountName 置 null
- 工作区：校验路径存在且为目录，判断 isGitRepo
- 路由用 zod 校验，错误按 ERROR_HTTP_STATUS 返回
约束：只改上述文件和对应测试；不要修改 contracts/。
验收：fastify.inject 测试全部端点与 ApiEndpoints 一致。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.9 会话与工作区服务"
```

### 派工 1.10（已移除）

> 2026-10-04 起该模块已删除，不再派工。子 agent transcript 接口见 `services/subagent-transcript.ts`。

### 派工 1.11 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 1.11，contracts/src/api.ts 的 UPLOAD_LIMITS 与 attachments 端点，domain.ts 的 Attachment，backend/agy-profile.json 的 stream.imageInput。
任务：实现 backend/src/services/attachment/{store,convert,prompt-inject}.ts 与 routes/http/attachments.routes.ts，并在 session.send 中接入 prompt-inject（最少代码）。
要点：
- store：<workspace>/.agy-attachments/<YYYY-MM-DD>/<id>-<清洗后的文件名>，文件名只保留 [A-Za-z0-9._-]，处理 Windows 保留名；realpath 校验在附件目录内；确保工作区 .gitignore 含 .agy-attachments/
- convert：pdf → pdf-parse，docx → mammoth 转 Markdown，xlsx/xls → 每个 sheet 一个 CSV；写到同目录 <原名>.extracted.<ext>；失败只记日志
- prompt-inject：默认在末尾追加 <images_input>路径列表</images_input> 与 <files_input>路径列表</files_input>（有提取文本时一并列出）；imageInput.supported 为 true 时按 profile 模板返回原生图片数据
- 路由：@fastify/multipart，遵守 UPLOAD_LIMITS；超限 ATTACHMENT_TOO_LARGE；非白名单图片类型按普通文件处理
约束：只改上述文件、session.ts 接入点和对应测试；不要修改 contracts/。
验收：恶意文件名（../、绝对路径、CON）不会逃逸；注入结果快照测试。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.11 附件服务"
```

### 派工 1.12（已移除）

> 2026-10-04 起该模块已删除，不再派工。

### 派工 1.13 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 1.13，contracts/src/domain.ts 的 Model / Prefs / Capabilities / Health，services/ports/model-catalog.port.ts，backend/agy-profile.json 的 catalog 部分，fixtures/agy/catalog/。
任务：实现 backend/src/integrations/agy/catalog.ts、services/model.ts、services/prefs.ts、routes/http/{models,prefs,system}.routes.ts。
要点：
- catalog：按 profile.catalog 执行版本与模型命令，按 modelsParser 解析（对 fixtures 做快照测试）
- model：缓存 10 分钟，refresh=true 强制刷新；id 以 gemini 开头归为 'gemini'，其余 'third_party'；isDefault 由 prefs.defaultModel 决定
- prefs 默认值：showThinking=true、maxConcurrentRuns=3、stallTimeoutSeconds=180，其余 null
- capabilities：features 由 profile 推导；profileAgyVersion 取 profile.agyVersion
- agy 未安装时 capabilities 返回 agyPath=null，models 返回 AGY_NOT_INSTALLED
约束：只改上述文件和对应测试；不要修改 contracts/。
验收：fastify.inject 测试全部端点。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.13 模型、偏好、系统接口"
```

### 派工 1.14 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6 账号模型与租约、模块 1.14 的全部潜在死穴，services/ports/credential.port.ts，backend/agy-profile.json 的 credentials 部分，docs/VERIFY.md 的 V7。V7 没有本机探测结论时先停下来告诉我，不要猜条目名或格式。
任务：
1. （已删除：home 隔离不在本期实现）
2. integrations/agy/dpapi.ts：用 Windows DPAPI（CurrentUser 范围）加密与解密 Buffer；非 Windows 平台抛出明确错误
3. integrations/agy/credential-store.ts：按 profile.credentials 的凭据条目模式（用 @napi-rs/keyring 读写）与凭据文件列表实现 snapshot() / restore(snapshot) / clear() / isPresent()；快照用 dpapi 加密后写入 DATA_DIR/credentials/<name>/
4. services/account/lease-lock.ts：基于 utils/rw-lock，全局一把锁
5. services/account/account.ts：list、setDefault、delete、whoami、acquireLease()（返回租约）；switch 流程：tryWrite（失败返回 ACCOUNT_BUSY 或 ACCOUNT_SWITCH_IN_PROGRESS）→ 备份当前 live → restore 目标 → 校验 → 删除备份；任一步失败用备份恢复；运行结束释放租约时，把 live 凭据回写到该账号的快照；成功后 publishGlobal(account.changed)
6. routes/http/accounts.routes.ts（登录相关端点由 1.15 实现，这里先注册 list / save / switch / delete）
约束：只改上述文件和对应测试；凭据内容绝不进入日志、数据库、API 响应；不要修改 contracts/。
验收：锁的并发测试（切换与切换、切换与运行、运行结束释放）；模拟 restore 失败时恢复原凭据；测试日志中搜不到凭据内容。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 1.14"。
复审通过后执行：git add <本模块的具体文件路径> && git commit -m "feat: 完成模块 1.14 凭据快照与账号服务"
```

### 派工 1.15 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6、模块 1.15 的潜在死穴，contracts/src/domain.ts 的 AccountLoginSession，services/ports/login.port.ts，backend/agy-profile.json 的 login 部分，docs/VERIFY.md 的 V10，以及已完成的 services/account/account.ts 与 credential-store.ts。V10 没有本机探测结论时先停下来告诉我。
任务：
1. integrations/agy/login-terminal.ts：实现 LoginPort：open() 用 profile.login.argv 在新的系统终端窗口中启动 agy（Windows 用 `cmd /c start "" ...`），返回可关闭的句柄；服务端不读取、不解析终端输出；启动器可注入以便测试
2. 在 account.ts 中实现登录编排与 POST/GET/DELETE /api/accounts/login 路由：
   · 状态机 pending → awaiting_browser（终端已弹出，authUrl 为 null）→ completed / failed / cancelled
   · 持写锁 → 备份 live → clear → 弹出终端 → 每 2 秒用 credential-store.isPresent() 检查；检测到后再等 2 秒、两次读取一致才 snapshot 为新账号 → 按请求决定恢复原账号或保持新账号
   · 10 分钟超时自动取消；同一时间只允许一个登录流程
   · 成功、取消、超时、服务关闭四条结束路径都在同一个 finally 中执行恢复并释放写锁
约束：只改上述文件和对应测试；不要修改 contracts/；不要实现任何 OAuth 流程或打开授权链接，登录完全交给 agy 自己。
验收：用假终端启动器与假凭据存储覆盖成功、取消、超时、服务关闭；每条路径结束后 live 凭据状态正确、写锁已释放。
完成后提示我执行：git add <本模块的具体文件路径> && git commit -m "feat: 完成模块 1.15 终端窗口登录"
```

### 派工 1.16（已取消）

额度改由 1.17 查询额度接口，本模块不再派工。

### 派工 1.17 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.7、模块 1.17 的潜在死穴，contracts/src/domain.ts 的 QuotaSnapshot 与 QuotaSource，services/ports/quota-probe.port.ts，backend/agy-profile.json 的 quota 部分，docs/VERIFY.md 的 V7 与 V12，fixtures/agy/quota/ 中脱敏后的接口响应。V12 没有本机探测结论或没有 fixtures 时先停下来告诉我，不要按记忆编写接口格式。
任务：
1. integrations/agy/oauth-client.ts：按 profile.quota 中记录的规则从 agy 程序中读取 OAuth 客户端标识；只缓存在内存，不写盘、不写日志；读取失败返回 null
2. integrations/agy/quota-api.ts：实现 QuotaProbePort.probe(accountName)：
   · 通过 credential-store 读取 live 凭据中的 refresh token → 向 profile.quota.tokenUrl 换取 access token（内存缓存，过期前 60 秒刷新）→ 调用 profile.quota 中的额度接口 → 解析成 { groups } | null
   · 解析为纯函数，对 fixtures 做快照测试；任何必需字段缺失就返回 null，不输出部分结果
   · 10 秒请求超时；错误信息里去掉 token 与请求头
3. services/quota.ts：
   · get(accountName?, refresh?)：返回 QuotaSnapshot（source='quota_api'），写入 quota_cache
   · 读取 live 凭据前申请读锁；拿不到就返回缓存并标 stale
   · 每账号 1 分钟限流；同一账号并发请求合并为一次
   · 失败保留旧数据并标 stale；从未成功过时 source='unavailable'、groups 为空
   · 收到 account.changed 时作废相关缓存；查询返回时若请求账号的缓存已被作废，丢弃结果；成功后 publishGlobal(quota.updated)
4. routes/http/quota.routes.ts
约束：只改上述文件和对应测试；不要修改 contracts/；除 profile.quota 中列出的 token 与额度接口外不调用任何其他私有接口；token、客户端标识不进入日志、数据库、API 响应。
验收：解析器快照测试；限流、合并、stale、unavailable、作废后丢弃迟到结果、读锁获取失败都有测试；测试日志中搜不到 token；用本机真实账号手动跑一次并确认面板数据与官方客户端一致。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 1.17"。
复审通过后执行：git add <本模块的具体文件路径> && git commit -m "feat: 完成模块 1.17 额度接口与缓存"
```

### 派工 1.18 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.1–§2.3 和模块 1.18。后端各模块已完成。
任务：实现 backend/src/app.ts 与 backend/src/main.ts。
要点：
- app.ts：手写构造注入：加载 profile → 创建 integrations 实现 → 创建 repos → 按依赖顺序创建 services（把前面模块中的最小接口替换为真实实现）→ 注册 http、ws、internal 路由
- main.ts：读配置 → 迁移 → 生成 internal.token（如不存在）→ supervisor.reapOrphans() → 监听
- 生产模式静态托管 frontend/dist，非 /api 与 /internal 的未命中路径返回 index.html
- 优雅关闭：拒绝新运行 → 中止全部运行并等待 run.completed（最多 10 秒）→ 取消进行中的登录流程（触发恢复）→ 冲刷 event-bus → 关闭数据库
- 确认 ESLint 规则「services 不得 import integrations」生效
约束：只改 app.ts、main.ts 和一个启动冒烟测试；接口对不上时记录下来告诉我，不要大改其他模块。
验收：AGY_BIN=fake-agy 启动后，冒烟测试用 ws 客户端走通"创建工作区 → 创建会话 → 发送 → run.started … run.completed"；npm run lint 通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 1.18 后端装配与启动"
然后提醒我：到达集成检查点 A，请呼叫 Opus 统一复查所有 🟡 后端模块。
```

### 派工 2.1 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.10、§2.11、模块 2.1。
任务：搭建 frontend/ 界面骨架与主题。
要点：
- Tailwind + shadcn/ui；src/theme.css 定义 Antigravity 风格深色主题变量（背景、面板、悬浮层、边框、主次文字、强调色、成功/警告/错误色、等宽字体）
- App.tsx：顶栏占位（工作区、模型、额度、账号、连接状态）+ 两栏布局（左 260px、中自适应；原右栏 Artifacts 已移除）
- vite.config.ts：开发代理 /api 与 /ws 到 http://127.0.0.1:8790（ws: true）
- 路由：/、/accounts、/settings、/playground（仅开发模式），先放占位组件
约束：只改 frontend/；不引入 store 或 API 调用；不要修改 contracts/。
验收：npm run dev -w frontend 可见完整布局；npm run build -w frontend 通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.1 前端骨架与主题"
```

### 派工 2.2 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 2.2，contracts/src/api.ts、errors.ts。
任务：实现 frontend/src/api/http.ts 与 endpoints.ts。
要点：
- request<K extends EndpointKey>(key, {params, query, body})：解析方法与路径，替换 :param，编码 query；body 为 FormData 时不设置 Content-Type；返回 EndpointResponse<K>
- 非 2xx 解析 { error } 抛 ApiError（code、message、retryable、status）；网络错误抛 ApiError('INTERNAL', retryable=true)
- token 从 localStorage('agy-studio-token') 读取
- endpoints.ts：每个端点一个类型化函数；uploadAttachments(files, workspaceId, sessionId, onProgress) 用 XMLHttpRequest 实现进度
约束：只改这两个文件和对应测试；不要修改 contracts/。
验收：vitest 覆盖路径参数、query 编码、错误解析、FormData。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.2 HTTP 客户端"
```

### 派工 2.3 🔴

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §1.2、§1.3、模块 2.3，contracts/src/ws.ts。
任务：实现 frontend/src/api/ws.ts。
要点：
- WsClient 单例：状态 connecting / open / reconnecting / closed，可订阅
- 按 heartbeatIntervalMs 发 ping，两个周期无 pong 主动重连
- 重连延迟 min(reconnectMaxMs, reconnectBaseMs * 2^attempt) + 抖动；页面隐藏时乘 4；连接成功后归零
- subscribe(sessionId, handler) / unsubscribe；维护每会话 lastSeq；重连后一次性发送 session.subscribe 恢复全部订阅
- event 帧：seq ≤ lastSeq 丢弃；seq > lastSeq+1 对该会话重订；否则更新 lastSeq 并回调
- subscribed.latestSeq < 本地 lastSeq：回调 onReset 并从 0 重订
- send(frame) 返回 Promise，按 requestId 等 ack / nack，10 秒超时；未连接时入队，恢复后发送，排队超过 10 秒按超时处理
- 回调通过 queueMicrotask 派发，避免 onmessage 中同步重入 store
约束：只改 ws.ts 和对应测试；不要修改 contracts/。
验收：mock WebSocket 服务测试断线重连、跳号、重复帧、ack 超时、离线排队。
⚠️ 高危模块：完成后先不要提交，告诉我"请呼叫 Opus 复审模块 2.3"。
复审通过后执行：git add . && git commit -m "feat: 完成模块 2.3 WS 客户端"
```

### 派工 2.4 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §1.3、§2.10 时间线条目、模块 2.4，contracts/src/events.ts。
任务：实现 frontend/src/domain/timeline.types.ts 与 timelineReducer.ts。
要点：
- 定义 TimelineItem 联合类型（UserMessage、Thinking、AssistantMessage、Tool、ToolGroup、Subagent、RunDivider、Error、StalledNotice）
- reduce(state, envelope) 纯函数，不修改入参：
  · thinking.delta 按 blockId 累加，记录起止时间算 durationMs
  · message.delta 按 messageId 累加
  · tool.* 按 toolCallId 合并
  · 同一运行中连续 2 个以上 kind 为 view_file 或 search 的工具合并为 ToolGroup
  · subagent.spawned 挂到 parentToolCallId 对应条目下；subagent.step 追加到对应子 agent
  · run.completed → RunDivider（耗时、用量、状态）；run.error → Error；run.stalled → StalledNotice；raw 忽略
- 导出 reduceAll(envelopes)
约束：只改 frontend/src/domain/ 和对应测试；不引入 React 或 store；不要修改 contracts/。
验收：手工构造覆盖所有分支的事件序列并快照；reduceAll 两次结果深度相等；用 Object.freeze 验证不修改入参。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.4 时间线 reducer"
```

### 派工 2.5 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.10、模块 2.5，frontend/src/api/ 与 frontend/src/domain/ 的公开接口。
任务：用 zustand 实现 frontend/src/stores/ 下的 session、workspace、prefs、quota、account、connection、ui 与 bootstrap.ts。
要点：
- session.store：slots[sessionId] = {events, timeline, lastSeq, activeRunId, loading, error}；openSession：REST 按 afterSeq 分页拉完历史并 reduce → wsClient.subscribe；实时事件增量 reduce；onReset 时清空重载；send、abort；切换会话保留槽位；list 字段响应 session.upserted / session.deleted
- quota.store 响应 quota.updated；account.store 响应 account.changed，并触发 quota 刷新
- connection.store 镜像 wsClient 状态
- ui.store：showThinking 本地覆盖、各会话已读的 lastSeq、主题偏好
- bootstrap.ts：统一连接 WS 并分发 global 事件
约束：只改 frontend/src/stores/ 和对应测试；不写组件；不要修改 contracts/。
验收：vitest（mock api 与 wsClient）覆盖打开会话、实时增量、重置、全局事件。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.5 状态层"
```

### 派工 2.6 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.11、模块 2.6 表格，frontend/src/domain/timeline.types.ts、frontend/src/theme.css。
任务：实现 frontend/src/components/timeline/ 下的无状态组件：ThinkingBlock、ToolCard（分发到 FileEditCard / CommandCard / SearchCard / BrowserCard / McpCard / GenericToolCard）、ToolGroupCard、MessageMarkdown、RunDivider、ErrorNotice、StalledNotice、StatusDot。
要点：
- ThinkingBlock 默认折叠，标题 "Thought for Ns"，运行中显示 "Thinking…" 动画；hidden 时不渲染
- FileEditCard：图标 + 路径 + 绿色 +N / 红色 −N，点击展开参数
- CommandCard：命令 + 终端风格等宽输出（默认 20 行，可展开），失败红色边框
- MessageMarkdown：react-markdown + remark-gfm + shiki，代码块复制按钮
- 风格：紧凑、低对比面板、细边框、小圆点状态
- 在 /playground 中用假数据展示所有组件的运行中、成功、失败状态
约束：只改 components/timeline/ 与 Playground；组件不得 import store 或 api；不要修改 contracts/。
验收：/playground 显示正常；npm run build -w frontend 通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.6 时间线原子组件"
```

### 派工 2.7 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 2.7 表格，frontend/src/domain/timeline.types.ts 的 SubagentItem，frontend/src/api/endpoints.ts 的子 agent transcript 函数。
任务：实现 frontend/src/components/timeline/SubagentCard.tsx（无状态）与 SubagentCardContainer.tsx。
要点：
- SubagentCard：角色、类型、状态点、初始 prompt 摘要；展开后渲染嵌套时间线（复用 ThinkingBlock、ToolCard、MessageMarkdown）
- 容器：运行中直接用 store 中的步骤；已结束且无步骤时首次展开懒加载 transcript，结果缓存在组件外
- 超过 200 步只渲染最后 200 步，提供"显示更早的步骤"
约束：只改这两个文件、Playground 示例和对应测试；不要修改 contracts/。
验收：反复展开只请求一次；运行中实时追加。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.7 子 agent 卡片"
```

### 派工 2.8 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 2.8 表格，contracts/src/api.ts 的 UPLOAD_LIMITS，frontend/src/stores/session.store.ts，api/endpoints.ts 的 uploadAttachments。
任务：实现 frontend/src/components/composer/ 下的 Composer、AttachmentChip、ModelPicker、EffortPicker、ModePicker。
要点：
- 自动增高文本框；Enter 发送、Shift+Enter 换行；isComposing 期间 Enter 不发送
- 附件：按钮选择、粘贴图片、拖拽、移动端 <input accept="image/*" capture="environment">
- 图片上传前 canvas 压缩长边到 2048（GIF 除外）；显示进度；失败可重试或删除；上传中禁用发送
- 运行中发送按钮变为停止
- 草稿按 sessionId 存 localStorage，发送成功后清空
约束：只改 components/composer/ 和对应测试；不要修改 contracts/。
验收：Testing Library 覆盖组字回车、粘贴图片、上传失败重试、运行中停止。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.8 输入框与附件"
```

### 派工 2.9 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6、§2.11、模块 2.9 表格，frontend/src/stores/ 中 session、workspace、account 的接口。
任务：实现 frontend/src/components/inbox/ 下的 InboxList、InboxItem、WorkspaceSwitcher、AddWorkspaceDialog、NewSessionButton、ImportSessionsButton，并挂到左栏与顶栏。
要点：
- InboxList 分组：运行中、待查看（运行已结束但已读 lastSeq 小于会话 lastSeq）、已完成
- InboxItem：标题、相对时间、状态点
- AddWorkspaceDialog：输入绝对路径，显示后端错误
- NewSessionButton：直接创建
约束：只改 components/inbox/ 与挂载点；不要修改 contracts/。
验收：session.upserted 时列表实时更新；npm run build -w frontend 通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.9 收件箱与工作区"
```

### 派工 2.10（已移除）

> 2026-10-04 起该模块已删除，不再派工。

### 派工 2.11 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.6、§2.7、模块 2.11 表格，contracts/src/domain.ts 的 QuotaSnapshot / Account / AccountLoginSession，frontend/src/stores/ 中 quota 与 account 接口。
任务：实现 components/quota/（QuotaRing、QuotaPanel）、components/account/（AccountMenu）与 views/AccountsView.tsx。
要点：
- QuotaRing：所有未 disabled 桶中 remainingFraction 最小者，>50% 绿、20–50% 黄、<20% 红；source='unavailable' 时显示灰色问号
- QuotaPanel：标题与说明、分组、每个桶的名称、进度条、百分比、重置倒计时；disabled 置灰；stale 显示"数据可能过期"；底部显示获取时间；source 为 unavailable 时整块显示"额度暂不可用"，不影响其他功能；刷新按钮（后端每账号 1 分钟限流，前端在冷却期内置灰）
- AccountMenu：当前默认账号；列表中显示每个账号的运行数；切换遇到 ACCOUNT_BUSY 时提示"有任务正在运行"；"添加账号"会弹出一个终端窗口，界面提示"请在弹出的终端中完成登录"并显示等待状态与取消按钮
- AccountsView：账号表格（名称、邮箱、类型、备注、保存时间、删除）；"登录新账号"：输入名称 → 调用 login → 提示"请在弹出的终端窗口中完成登录" → 每 2 秒轮询 → 完成或失败后刷新；支持取消；10 分钟无结果显示超时
约束：只改上述文件与顶栏挂载点；不要修改 contracts/。
验收：/playground 展示 QuotaPanel 各种状态；npm run build -w frontend 通过。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.11 额度与账号界面"
```

### 派工 2.12（已移除）

> 2026-10-04 起该模块已删除，不再派工。

### 派工 2.13 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md §2.11、模块 2.13 表格。2.6–2.12 已完成。
任务：组装 frontend/src/views/ManagerView.tsx 的中间对话区。
要点：
- @tanstack/react-virtual 渲染 timeline，每种条目映射到对应组件（Subagent 用容器组件）
- measureElement 动态行高，内容增长时重新测量
- 距底部 < 80px 时自动跟随；上滑后停止跟随并显示"回到底部"（附新消息数）
- 打开会话直接定位到底部
- 底部固定 Composer；顶部会话标题（双击重命名）
- 连接非 open 时顶部黄色提示条"连接中断，正在重连…"
约束：只改 ManagerView.tsx 及其私有子组件；不要修改 contracts/。
验收：Playground 构造 2000 条事件滚动流畅；流式输出时滚动位置不跳。
完成后提示我执行：git add . && git commit -m "feat: 完成模块 2.13 对话视图组装"
然后提醒我：到达集成检查点 B，请呼叫 Opus 统一复查所有 🟡 前端模块。
```

### 派工 3.1 🟡

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 模块 3.1。前后端已完成，tools/fake-agy 可用。
任务：新增 e2e/，用 Playwright 编写端到端测试，并在根 package.json 加 e2e 脚本。
要点：
- global-setup：AGY_BIN=fake-agy、临时 DATA_DIR 与 FAKE_AGY_HOME 启动后端（托管 build 后的前端）
- 用例：新建工作区与会话并发送 → 思考块、工具卡片、正文、分隔条；展开子 agent；运行中停止；刷新后时间线完整；setOffline 断网恢复后事件补齐且不重复；上传图片后发送；添加账号（后端注入假终端启动器）；额度面板显示数据
- 每个用例独立会话
约束：只新增 e2e/ 与根脚本；发现产品 bug 记录到 e2e/BUGS.md 并告诉我，不要改业务代码。
验收：npm run e2e 连续 3 次全部通过。
完成后提示我执行：git add . && git commit -m "test: 完成模块 3.1 端到端测试"
```

### 派工 3.2 🟢

```text
你是执行工程师。阅读 docs/ARCHITECTURE.md 设计原则、阶段 0、模块 3.2。
任务：编写 start.cmd 与根目录 README.md。
要点：
- start.cmd：检查 Node ≥ 20 与 agy（给出官方安装指引链接）→ frontend/dist 不存在则构建 → 启动后端 → 打开 http://127.0.0.1:8790
- README：功能列表；安装；首次使用（网页登录账号）；局域网或手机访问（必须设置 AGY_STUDIO_TOKEN，推荐 Tailscale，禁止公网暴露）；自动同意风险与自行 git 备份的建议；"agy 升级后"的处理步骤（运行 tools/discover 重新探测 → 更新 agy-profile.json 与 fixtures → 跑测试）
约束：只新增或修改 start.cmd 与 README.md。
验收：在干净的 Windows 机器上按 README 能跑起来。
完成后提示我执行：git add . && git commit -m "docs: 完成模块 3.2 启动脚本与 README"
```

---

## 生产级死穴自检清单

### 状态与连接

| 检查项 | 结论 |
|---|---|
| WebSocket 断开时运行会不会停？ | 不会，运行归服务端所有；重连后按 lastSeq 从数据库补发（1.8、2.3） |
| 补发与实时衔接会不会漏或重？ | 服务端先缓冲、补发后按 seq 去重再冲刷；客户端再按 seq 丢重、跳号重订 |
| 重连会不会雪崩？ | 指数退避加抖动，页面隐藏时降频；服务端单独断开慢客户端 |
| 运行会不会永远停在 running？ | 只完成一次守卫 + 看门狗 + 启动时清理孤儿，三条路径都收口到终止态 |
| 账号租约会不会泄漏导致永远无法切换？ | 租约在"只完成一次"守卫的同一位置释放（1.6）；读写锁不排队，不会死锁（1.1） |
| 登录中途失败会不会让 live 凭据处于被清空状态？ | 五条结束路径共用一个 finally 恢复（1.15） |
| 额度查询会不会拖垮系统或触发风控？ | 每账号 1 分钟限流、请求合并、10 秒请求超时、只在有页面查看时查询（1.17） |
| 服务崩溃后会不会留下僵尸进程？ | pid 入库，启动时终止进程树（1.6） |

### 上下文体积

| 检查项 | 结论 |
|---|---|
| 单个派工单是否足够小？ | 每个模块 1–5 个源文件；账号相关只剩凭据与账号（1.14）、终端登录（1.15）、额度接口（1.17）三块，statusline 桥接（1.16）已取消 |
| 执行模型需要读多少上下文？ | 每个 Prompt 只列需要读的章节、契约、端口与 profile 片段 |
| 前端长会话会不会卡？ | 虚拟滚动、delta 合并、子 agent 懒加载与截断 |

### 依赖单向性

| 检查项 | 结论 |
|---|---|
| 前后端循环依赖？ | 没有，两者只依赖 `contracts/` |
| 服务层与 agy 细节耦合？ | 没有，services 只依赖 ports；ESLint 规则禁止 services import integrations（0.1、1.18） |
| agy 知识散落在代码中？ | 没有，全部集中在 `integrations/agy/` 与 `agy-profile.json` |
| 前端组件与状态耦合？ | components 不 import store 或 api；views 与容器组件负责连接 |

### 专项风险

| 风险 | 对策 |
|---|---|
| agy 升级后行为变化 | 版本比对提示 → 重跑 `tools/discover` → 更新 profile 与 fixtures → 快照测试立刻暴露差异；未知输出降级为 `raw`。agy 会在后台自动升级（2026-10-03 本机从 1.2.12 升到 1.2.16），1.2.16 的复核结论见 VERIFY.md |
| 客户机器环境差异 | 用户名含空格、agy 不在 PATH、需要代理或直连、未装 Visual Studio、中文代码页——均已有对应处理与回归测试（0.1、1.6、1.13、1.15、1.18、3.2 的修订条目） |
| 官方没有文档的行为探测不到 | 每项探测都有降级方案（阶段 0 表格）；最坏情况下仍可用"只靠 CLI 参数 + stdout 事件"跑通核心对话 |
| 自动同意导致破坏性操作 | 不再内置回滚（检查点已于 2026-10-04 移除），README 要求发起任务前自行 git 提交；默认只监听本机；非本机访问强制 token |
| 凭据泄露 | 不入库、DPAPI 加密快照、日志脱敏、API 不返回、internal 接口只收回环地址并校验令牌 |
| 服务条款风险 | 登录只走 agy 自己的流程；私有接口只调用额度查询一个（与官方客户端相同的请求，每账号 1 分钟限流）；OAuth 客户端标识只在内存中使用；不做自动换号 |
| 许可证 | 全部自研；CloudCLI（AGPL）只读架构文档，不看不抄源码 |
