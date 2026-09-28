# AGY 黑盒探测结论记录（docs/VERIFY.md）

> 本文档记录阶段 0 黑盒探测清单中 V1–V11 的真实探测结论、证据文件以及对后续系统实现的影响。
> 知识来源遵循「零移植」设计原则：**只能是 Antigravity 官方文档（https://antigravity.google/docs）和本机真实探测录制结果**，绝不参考任何第三方 agy 包装项目。
> 探测结论中可机器读取的部分将沉淀入 `backend/agy-profile.json`。

---

## 阶段 0 探测总览表格（V1–V11）

| 编号 | 要探明的问题 | 结论 | 证据文件 | 对实现的影响 |
|---|---|---|---|---|
| **V1** | 一个 stream-json 进程能否通过 stdin 连续接收多轮消息，user 帧格式是什么 | **支持连续多轮 stdin 输入**。每轮以 `result` 事件标记结束，随后可写入下一轮；关闭 stdin 后进程以 0 退出。标准 user 帧为 `{"event":"user","message":{"content":"..."}}`（同时兼容 content block 列表格式）。 | `fixtures/agy/stream/multi-turn/stdout.jsonl`<br>`fixtures/agy/stream/simple-chat/stdout.jsonl` | **模块 1.6**：`RunSupervisor` 可采用单进程长连接多轮模式（`profile.stream.multiTurnStdin = true`），会话内无需频繁 spawn，大幅降低启动时延与初始化开销。 |
| **V2** | 开了 skip-permissions 后，流里是否仍有 permission / confirmation 事件，格式和回复方式 | **常规操作直接放行**。`init` 事件标明 `permission_mode: "always-proceed"`，文件读写与命令执行直接调用完成，流中无弹窗事件；若遇到跨工作区/极端敏感操作触发确认，需按 schema 回复。 | `fixtures/agy/stream/file-ops/stdout.jsonl`<br>`fixtures/agy/stream/command-exec/stdout.jsonl`<br>`fixtures/agy/stream/outside-workspace/stdout.jsonl` | **模块 1.7**：落实「四层兜底」设计：L1（CLI 参数 `--dangerously-skip-permissions`）放行绝大部分工具；L2（改写 settings）保底；L3 流适配器保留 permission 自动回复；L4 看门狗防死锁。 |
| **V3** | stream-json 的全部事件类型与字段；主会话是否有思考内容，在流里还是在磁盘文件里 | 顶层事件只有 `init`、`step_update`、`result` 三种；`step_type` 实录取值为 `user_input`、`agent_response`、`tool`、`subagent`、`system_message`（**不是** `tool_call`）。流内只有 `thinking_tokens` 计数，**没有思考正文**，需结合磁盘 transcript 追踪。详见下方「实录校正」。 | `fixtures/agy/stream/simple-chat/stdout.jsonl`<br>`fixtures/agy/stream/subagent/stdout.jsonl` | **模块 1.4**：`stream-schema.ts` 强校验已知事件并 passthrough，未知事件降级为 `raw`；**模块 1.5**：主会话思考过程需通过 `BrainPort` 从磁盘 transcript 增量读取。 |
| **V4** | user 消息能否携带图片（数组、base64 或专用参数） | **不支持原生图片块**。传入 `image` content block 时明确报错 `only "text"`；必须采用**路径注入**方式将图片本地绝对路径传入 prompt。 | `fixtures/agy/stream/image-path/stdout.jsonl`<br>`fixtures/agy/stream/image-path/stderr.txt` | **模块 1.11**：附件服务采用路径注入降级策略，将上传图片落盘到 `.agy-attachments/` 后，以 `<images_input>` 标签注入到用户 prompt 尾部。 |
| **V5** | agy 在磁盘上的目录布局：会话、transcript、artifacts、截图、录屏分别在哪 | **已实录**。全部位于 `%USERPROFILE%\.gemini\antigravity-cli\`；artifact 直接放在 `brain/<conversation_id>/` 下（如 `implementation_plan.md`、`walkthrough.md`），各自附带 `<name>.metadata.json`。截图、录屏未覆盖。详见「0.3 补录」。 | `fixtures/agy/fs/` | 模块 1.5, 1.10：决定数据根目录定位、会话导入与 Artifacts 实时追踪路径。 |
| **V6** | settings 文件的位置（全局、工作区）以及"总是放行"对应的键名和取值 | **部分实录**。用户级文件为 `%USERPROFILE%\.gemini\antigravity-cli\settings.json`，放行键为 `toolPermission: "always-proceed"`，另有 `artifactReviewPolicy: "always-proceed"`。`agy-profile.json` 当前的路径与 `security.alwaysProceed` 均不符。其他取值与工作区级文件未探明。 | `fixtures/agy/settings/` | 模块 1.7：实现 `SettingsPort.ensureAlwaysProceed`，保证 L2 兜底写入准确性。 |
| **V7** | 登录凭据存在哪：Windows 凭据管理器的哪些条目、还是哪些文件 | **已实录（静态探测）**。只有一个 Windows 凭据管理器通用条目：TargetName `gemini:antigravity`、UserName `antigravity`（`cmdkey` 显示为 `LegacyGeneric:target=gemini:antigravity`），数据为 UTF-8 JSON，内含 `token.refresh_token`。**没有凭据文件**；`~/.gemini/oauth_creds.json` 不属于 agy。详见下方「V7 · 登录凭据存储位置」。 | `fixtures/agy/cred/cred-probe.json` | 模块 1.14：快照目标只有这一个 keyring 条目；模块 1.17：refresh token 从该条目的 JSON 读取。 |
| **V8** | ~~覆盖 home 类环境变量后 agy 是否使用独立凭据~~ | 不再需要：当前设计只用 `credential_snapshot`（见 ARCHITECTURE.md） | — | — |
| **V9** | statusline 是否在无界面（stream-json）模式下也会被调用；传入的 JSON 字段（额度、邮箱、套餐、上下文用量） | *待模块 0.3 探测* | `fixtures/agy/statusline/` | 模块 1.16：确定被动额度推送在无界面运行时的可用性与解析映射。 |
| **V10** | 交互模式下 `/usage`、`/credits` 的输出格式；登录流程的命令、授权链接格式、成功标志 | **登录部分已实录**：没有 `login` 子命令，未登录时启动交互式 agy 会直接出现登录方式菜单（`1. Google OAuth`）；选择后打印 `accounts.google.com` 授权链接（`redirect_uri=https://antigravity.google/oauth-callback`，终端里会被硬换行），并提示 `paste the authorization code below`；用户在浏览器授权后复制页面上的授权码粘贴回车即完成，成功标志是回到主界面（显示邮箱和套餐）且 `gemini:antigravity` 条目出现。**产品决定：1.15 采用"显示链接 + 粘贴授权码"方式，不做跳转回调**。`/usage`、`/credits` 仍未实录。 | `fixtures/agy/pty/login-oauth.real.txt` | 模块 1.15, 1.17：决定伪终端登录流程状态机与主动额度探针解析规则。 |
| **V11** | `agy --version`、`agy models` 的输出格式；mode 的可选值 | **已实录**。`--version` 输出纯版本号 `1.2.12`；`models` 首行 `Fetching available models...`，其后每行 `id<TAB>显示名`；mode 为 `accept-edits`、`plan`；effort 为 `low|medium|high|max`。与 `agy-profile.json` 的 catalog 一致。 | `fixtures/agy/catalog/` | 模块 1.13：确定模型列表、运行模式、版本检测解析逻辑。 |
| **V12** | 额度接口的请求与响应格式（token 与身份信息脱敏） | **已实录（2026-09-29，agy 1.2.12）**。refresh token 取自 `gemini:antigravity` 条目，向 `oauth2.googleapis.com/token` 换 access token（200，`expires_in` 3599）；`loadCodeAssist` 200，返回 `currentTier` / `paidTier` / `cloudaicompanionProject`；`retrieveUserQuotaSummary` 200，返回 2 组 × 2 桶，桶标识 `gemini-weekly`、`gemini-5h`、`3p-weekly`、`3p-5h`，数值字段 `remainingFraction`（0–1），`resetTime` 为 UTC RFC3339（`Z` 结尾、无小数）；带 `project` 与空请求体结果相同。无效 access token → 401 `UNAUTHENTICATED`；无效 refresh token → 400 `invalid_grant`。agy 程序内有 2 组 OAuth client 候选，第一个 secret 与 `id_token.aud` 不匹配（401 `invalid_client`）。换 token 不会改写凭据条目。详见下方「V12 · 额度接口」。 | `fixtures/agy/quota/` | 模块 1.17：`quota-api.ts` 的请求与解析按此实现；`@napi-rs/keyring` 不可用于读取该条目（见 V12 事故记录，同样影响 1.14）。 |

---

## 实录校正（2026-09-28，本机 agy 1.2.12 真实录制）

下方 V1–V4 详细分析最初是在尚无录制数据时撰写的。以本节为准，冲突时以 `fixtures/agy/stream/` 中的实录为准。

录制场景：`simple-chat`、`file-ops`、`command-exec`、`subagent`、`quota-exhausted`、`image-path`、`image-block-fail`、`abort-midway`、`multi-turn`、`outside-workspace`。工作目录均为临时沙盒。

1. **启动延迟**：从 spawn 到第一个 `init` 事件约 8 秒；到第一个 `text_delta` 约 12 秒。看门狗与"中止"测试的时间阈值不能低于这个量级。
2. **step 生命周期**：同一个 `step_index` 先发 `state: "ACTIVE"`，结束时再发一条 `state: "DONE"`。`agent_response` 在 ACTIVE 阶段逐段带 `text_delta`，`DONE` 那条带最后一段 `text_delta`、`duration_seconds` 和 `usage`。一轮里会有多个 `agent_response` step，穿插在工具 step 之间。
3. **工具事件**（`step_type: "tool"`）：带 `tool_name` 和 `tool_info: { name, parameters }`，参数名为 PascalCase（如 `TargetFile`、`CommandLine`）。`DONE` 时 `run_command` 带 `tool_info.output`（命令输出原文）；`write_to_file` 等文件工具**没有** output 字段。
4. **命令输出编码**：中文 Windows 下 `run_command` 的 `output` 里中文是乱码（如 `目录` 显示为 `Ŀ¼`），是 agy 自身按错误编码读取 PowerShell 输出导致，流里拿到的就已经是乱码。前端终端卡片需要容忍，必要时考虑 GBK 回转。
5. **子 agent**（`step_type: "subagent"`，`tool_name: "invoke_subagent"`）：`subagent_info.subagents[]` 含 `type_name`、`role`、`initial_prompt`；`DONE` 时额外带子会话的 `conversation_id`、`log_uri`、`workspace_uris`。子 agent 自己的步骤**不在**主流里，只能通过 `log_uri` 指向的 transcript 追踪。
6. **transcript 路径（V5 的部分证据）**：`log_uri` 形如 `file:///<HOME>/.gemini/antigravity-cli/brain/<conversation_id>/.system_generated/logs/transcript.jsonl`。主会话大概率同样位于 `brain/<主 conversation_id>/` 下，待 0.3 的 fs-diff 确认。
7. **权限（V2）**：所有场景中除 `init.tools` 列表里的 `ask_permission` 工具名外，**没有任何权限请求事件**；读取工作区外的 `C:\Windows\win.ini` 也被直接放行。L3 自动回复目前没有实录样本可对照，应保持可选。
8. **多轮（V1）**：已实录确认。同一进程两轮，第二轮正确回答出第一轮记住的数字，`result.num_turns` 依次为 1、2，关闭 stdin 后退出码 0。
9. **错误**：无效模型时**没有 `init`**，只有一条 `result`（`status: "ERROR"`，`num_turns: 0`，`error` 里附带可用模型列表），stderr 同样有 `error: ...`，退出码 1。真正的额度耗尽无法人为触发，暂无实录。
10. **图片（V4）**：原生 `image` 块被拒绝，同样只有 `init` 加一条 ERROR `result`，退出码 1。路径注入可用：agent 通过 `view_file` 读取了 `docs/example.png` 并正确描述内容。
11. **中止**：强制终止进程树后**没有 `result` 事件**，退出码 1；已写出的每一行都是完整 JSON，没有半行。适配器必须能处理"没有 result 就结束"的情况。

---

## 0.3 补录（2026-09-28，本机 agy 1.2.12）

证据：`fixtures/agy/catalog/`（`version.txt`、`models.txt`、`help.txt` 为原始字节，`catalog-probe.json` 为解析结果）、`fixtures/agy/fs/`（`fs-diff.json`、`plan-run.jsonl`、`brain-sample/`）、`fixtures/agy/settings/user-settings.json`。路径中的用户名已替换为 `%USERPROFILE%` / `%USERNAME%`。

- **V11**：见总览表。`catalog-probe.ts` 的解析器对实录输出有效。
- **V5**：以 `--mode plan` 跑一轮后，新增文件全部落在 `%USERPROFILE%\.gemini\antigravity-cli\`：
  - `brain/<id>/.system_generated/logs/transcript.jsonl` 与 `transcript_full.jsonl`，另有按块切分的 `logs/chunks/transcript{,_full}/00000000.jsonl`
  - `brain/<id>/.system_generated/steps/<n>/output.txt`（工具输出，按步骤编号）
  - `brain/<id>/implementation_plan.md`、`walkthrough.md` 及各自的 `.metadata.json`，字段为 `summary`、`updatedAt`、`userFacing`，计划类另有 `requestFeedback: true`
  - `conversations/<id>.db`、`annotations/<id>.pbtxt`、`presence/<id>.lock`、`log/cli-<时间>.log`
  - `%LOCALAPPDATA%\agy` 只有程序本体，无数据写入
- **V6（部分）**：`settings.json` 实际内容为 `{"artifactReviewPolicy":"always-proceed","toolPermission":"always-proceed"}`。这解释了 V2 录制中没有任何权限事件：本机本就处于总是放行状态。`%USERPROFILE%\.antigravity\settings.json` 不存在。
- **plan 模式不等于只读**：在 `artifactReviewPolicy: always-proceed` 下，计划被自动批准（回复中出现「方案已通过审批，开始执行」），agy 随即创建并运行了 `hello.js`。
- **进程生命周期与续聊**（`fixtures/agy/stream/resume-conversation/`）：发送 user 帧后关闭 stdin，agy 在 `result` 后以 0 退出（约 11 秒）；stdin 保持打开时进程在 `result` 后继续等待下一轮，不会退出。续接已有会话用 `--conversation <id>`，上下文保留、`conversation_id` 不变、`num_turns` 累加；`--resume` 不存在，agy 报 `flags provided but not defined: -resume` 并以 2 退出。
- **transcript 实际格式**（`fixtures/agy/fs/brain-sample/.system_generated/logs/transcript.jsonl`）：每行字段为 `step_index`、`source`、`type`、`status`、`created_at`、`content`，可选 `truncated_fields`；`type` 实录取值为 `USER_INPUT`、`PLANNER_RESPONSE`、`GENERIC`、`SYSTEM_MESSAGE`。
- **仍需探明**：`toolPermission` 的其他取值及其对应的权限事件格式（需把设置改为非放行后重录）、工作区级 settings 是否存在、截图与录屏位置、V7–V10。
- **注意**：`fixtures/agy/pty/usage.txt`、`fixtures/agy/pty/credits.txt`、`fixtures/agy/statusline/statusline.json` 是 0.4 阶段编造的占位数据（邮箱 `user@example.com`、模型 `Gemini 2.5`），**不是实录**，不得作为 1.15–1.17 的依据。

## 阶段 0 探测详细分析（模块 0.2 交付项：V1–V4）

### V1 · stream-json 进程连续多轮输入与 user 帧格式

#### 1. 要探明的问题
1. 一个使用 `--input-format stream-json --output-format stream-json` 启动的 agy 进程，能否通过 stdin 连续发送多轮输入？
2. 单轮完成的标志是什么？多轮之间 stdin 如何保持同步？
3. user 帧的标准 JSON 格式是什么？如果不合法或字段缺失，CLI 如何响应？

#### 2. 探测方法
使用 `tools/discover/record-stream.ts`：
- 对比单轮输入与 `--turns` 多轮文件输入；
- 监控 stdout 流中各事件序列及时间戳；
- 探测在首轮发出 `result` 事件后继续向 stdin 写入下一轮帧的表现；
- 在 agy 二进制中查找相关错误诊断字符串。

#### 3. 观察要点与事实证据
1. **启动与初始化**：
   进程启动后立即在 stdout 发出 `init` 事件：
   ```json
   {
     "event": "init",
     "conversation_id": "c502b261-c055-461f-a5dd-9ab622b785e1",
     "init": {
       "cwd": "G:\\new",
       "tools": ["ask_custom_permission", "ask_permission", "run_command", "view_file", ...],
       "permission_mode": "always-proceed"
     }
   }
   ```
2. **标准 user 帧格式**：
   官方 stream-json 模式要求的标准 user 帧格式为：
   ```json
   {"event":"user","message":{"content":"你的输入文本"}}
   ```
   也支持兼容 content blocks 数组结构：
   ```json
   {"event":"user","message":{"content":[{"type":"text","text":"你的输入文本"}]}}
   ```
   若缺少 `event` 字段，报错：`stream input message is missing the "event" field`；
   若缺少 `message` 字段，报错：`stream input "user" message is missing the "message" field`；
   若没有内容，报错：`stream input "user" message has no content`。
3. **轮次生命周期**：
   - 每一轮输入后，agy 依次产出 `step_update` (step_type: `user_input` -> `agent_response` / `tool` / `subagent`)；
   - 本轮完成时产出 `event: "result"`，带有 `num_turns: 1` 和耗时、token 统计；
   - 收到 `result` 后进程**不会退出**，stdin 依然保持监听；
   - 写入第 2 轮 user 帧后，agy 会输出下一批递增的 `step_update`（`step_index` 连续递增），并在完成后发出 `num_turns: 2` 的 `result` 事件；
   - 当调用 `child.stdin.end()` 关闭 stdin 时，CLI 打印 `stream input closed after N turn(s)`，随后以退出码 0 正常退出。

#### 4. 对系统实现的影响
- **模块 1.6 (`RunSupervisor`)**：
  确定了 `multiTurnStdin` 原生可行。同一会话在连续交互时可以维持长连接进程，只向 stdin 写入新的 user 帧，无需每轮新建进程，彻底消除进程冷启动带来的延迟与会话状态重载。

---

### V2 · --dangerously-skip-permissions 下的权限与确认事件

#### 1. 要探明的问题
1. 开启官方参数 `--dangerously-skip-permissions` 后，流中是否还会出现权限确认类事件（例如 `ask_permission`）？
2. 敏感操作（写文件、运行命令、访问非工作区文件）是否会被直接放行？
3. 如果仍然触发确认，事件结构是什么，回复模板是什么？

#### 2. 探测方法
通过 `record-stream.ts` 录制 3 个敏感场景：
- `file-ops`: 创建并写入本地文件、修改文件、删除文件；
- `command-exec`: 运行 shell 命令；
- `outside-workspace`: 尝试读取工作区外的系统文件。

#### 3. 观察要点与事实证据
1. `init` 事件中 `permission_mode` 明确为 `"always-proceed"`。
2. 在此模式下，常规的代码编辑类工具（`write_to_file`, `replace_file_content`）和执行类工具（`run_command`）均无需交互式确认，直接进入执行并返回结果。
3. 二进制特征：binary 中内置了 `ask_permission`、`ask_custom_permission` 工具，以及 `"Yes, and always allow..."` 等持久化提示字符串。在未跳过权限时，这些工具会阻断流程等待交互输入。

#### 4. 对系统实现的影响
- **模块 1.7 (`autoapprove`)**：
  核心痛点得到验证：单纯依靠参数 `--dangerously-skip-permissions` 可以消除大部分交互式阻断（作为 L1 兜底）。但由于 agy 支持非工作区安全策略与沙箱配置，系统必须按照架构设计完整实现四层兜底：
  - **L1 (CLI 参数)**: 必须固定包含 `--dangerously-skip-permissions`；
  - **L2 (Settings 改写)**: 启动前确保 settings 文件中 `alwaysProceed` 开启；
  - **L3 (流中事件自动回复)**: 适配器如果侦测到 `ask_permission` 事件，必须立刻向 stdin 写入同意帧；
  - **L4 (卡死看门狗)**: 超时未产生任何 stdout 输出时自动注入同意，双重超时熔断。

---

### V3 · stream-json 事件类型与思考内容定位

#### 1. 要探明的问题
1. stream-json 包含哪些顶层事件类型及字段？
2. 主 agent 的思考过程（Thinking）是否在流中实时推送？如果在流中，字段结构是什么？
3. 如果流中没有思考正文，思考过程保存在哪里？

#### 2. 探测方法
使用 `record-stream.ts` 录制纯对话与代码编写场景，分析各事件及其 `usage` 负载。

#### 3. 观察要点与事实证据
1. **主要事件类型**：
   - `init`：会话初始化事件。字段：`conversation_id`、`init.cwd`、`init.tools`、`init.permission_mode`；
   - `step_update`：核心增量更新。字段：`conversation_id`、`step_index`、`state` (`ACTIVE` | `DONE`)、`step_type` (`user_input` | `agent_response` | `tool` | `subagent` | `system_message`)、`text_delta`、`duration_seconds`、`usage`、`tool_name`、`tool_info`、`subagent_info`；
   - `result`：每轮终态事件。字段：`conversation_id`、`status` (`SUCCESS` | `ERROR`)、`response`、`duration_seconds`、`num_turns`、`usage`、`error`。
2. **思考内容表现**：
   - 在流输出中，`step_update.usage` 明确返回了思考 token 用量：`"thinking_tokens": 186`；
   - 但在 stdout 流中，`text_delta` 仅输出回复正文，未以独立思考 delta 流的形式推送到 stdout；
   - 二进制与上下文线索指示，完整推理思考内容保存在磁盘的会话 transcript 文件中（带有 `CONTEXT_KIND_MODEL_THOUGHT` 标记）。

#### 4. 对系统实现的影响
- **模块 1.4 (`stream-schema` 与 `stream-adapter`)**：
  为 `init`、`step_update`、`result` 编写 zod schema 并 passthrough 未知字段；未知类型一律降级为 `raw` 事件。
- **模块 1.5 (`BrainFs` 与 `transcript.ts`)**：
  主会话的完整思考过程需要从磁盘 transcript jsonl 增量追踪获取，转为 `thinking.delta(source='transcript')` 合并到时间线。

---

### V4 · user 消息携带图片支持情况

#### 1. 要探明的问题
1. user 帧能否通过 content 数组传递原生图片块（例如 `type: "image"` 或 base64）？
2. CLI 对原生图片块的处理方式是什么？
3. MVP 阶段附件方案应如何收敛？

#### 2. 探测方法
使用 `--frame-template` 向 agy 注入包含 `[{"type": "image"}]` 的 user 帧。

#### 3. 观察要点与事实证据
1. **实测报错**：
   当尝试传入包含 `image` 块的 user 消息时，agy 立即报出明确错误：
   ```text
   error: stream input content block type "image" is not supported (only "text")
   ```
   并在 `result` 事件中返回：
   ```json
   {
     "event": "result",
     "result": {
       "status": "ERROR",
       "error": "stream input content block type \"image\" is not supported (only \"text\")"
     }
   }
   ```
2. **二进制特征印证**：
   CLI 内部硬编码了检查逻辑：`stream input content block type %q is not supported (only %q)`，当前版本仅支持 `"text"`。

#### 4. 对系统实现的影响
- **模块 1.11 (`attachment` 附件服务)**：
  确认了架构设计中的**路径注入**策略是唯一且必须的方案：
  前端上传的图片保存在 `<workspace>/.agy-attachments/` 目录下后，后端在拼装用户 prompt 时统一在末尾追加绝对路径或相对路径列表（`<images_input>...</images_input>`），引导 agy 调用内置文件读取工具处理图片，不可使用原生 image content block。

---

## 阶段 0 后续探测项（模块 0.3 交付项：V5–V11 占位）

### V5 · agy 磁盘目录布局（会话、transcript、artifacts）
- **要探明的问题**：会话、transcript、artifacts、截图、录屏在磁盘上的精确路径；
- **探测方法**：模块 0.3 `fs-diff.ts` 对用户目录快照对比；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/fs/`；
- **对实现的影响**：决定模块 1.5 `BrainPort` 的会话目录模式与监听路径。

### V6 · settings 文件的位置与 always-proceed 配置
- **要探明的问题**：全局与工作区 settings 文件路径，"总是放行"键名与结构；
- **探测方法**：模块 0.3 切换设置后比对文件差异；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/settings/`；
- **对实现的影响**：决定模块 1.7 `SettingsPort.ensureAlwaysProceed` 的实现。

### V7 · 登录凭据存储位置
- **要探明的问题**：登录凭据存储在 Windows 凭据管理器（cmdkey /list）还是特定文件；
- **探测方法**（2026-09-28，本机 agy 1.2.12，已登录状态）：`cmdkey /list` 取条目名；用 Win32 `CredRead` 读取候选条目，只输出元数据、字段名、类型与长度；对比 `~/.gemini/` 下同结构文件的账号是否一致（只输出 true/false）；在 `agy.exe` 中检索相关字符串。**未做登出/登录前后差异**。
- **结论**：
  - **条目**：只有一个 Windows 凭据管理器条目，`CRED_TYPE_GENERIC`，`Persist = LOCAL_MACHINE`，TargetName **`gemini:antigravity`**，UserName `antigravity`，无 Comment、无 Attributes。`cmdkey` 显示的 `LegacyGeneric:target=` 只是显示前缀，不是 TargetName 的一部分。
  - **写入方**：agy 内嵌 Go 库 `zalando/go-keyring`，它在 Windows 上把 TargetName 写成 `<service>:<user>`，即 service `gemini`、user `antigravity`。
  - **编码格式**：数据约 1.4 KB，UTF-8 JSON（无 BOM，未经 base64 包装）。结构为 `{ token: { access_token, token_type: "Bearer", refresh_token, expiry }, auth_method: "consumer", id_token }`；`expiry` 是 RFC3339 格式（7 位小数加时区偏移）；`id_token` 是 Google JWT，含 `sub`、`email` 声明，可离线识别账号。
  - **刷新行为**：条目 LastWritten 与 `token.expiry` 相差约 1 小时，说明 agy 刷新 access_token 后会把整条 JSON 写回同一条目。
  - **没有凭据文件**。`%USERPROFILE%\.antigravity\` 不存在。`~/.gemini/oauth_creds.json` 结构与条目相同，OAuth 客户端也相同，但属于另一个 Google 账号，已过期，`google_accounts.json` 也指向那个账号；`agy.exe` 中不含 `oauth_creds`、`google_accounts` 字符串。这两个文件是同一客户端的其他 Google 程序遗留的，**agy 不读写**。
- **与 Antigravity IDE 共用（强间接证据）**：IDE 的 `resources\bin\language_server.exe` 与 agy.exe 内含同一套 `codeassistclient` token 存储代码和同一个 go-keyring 库。条目在 22:19:18 与 23:14:27 两次被重写（换了 access_token，账号不变），这两个时间点都没有 agy CLI 进程在运行；间隔 55 分钟，符合常驻进程自动刷新 token 的规律，而唯一的常驻进程是 IDE language server。
- **登出/登录动态差异（已实录，IDE 未运行）**：登出时凭据管理器只少了 `gemini:antigravity`，登录时只多了这一条；两次都**没有任何凭据文件**被创建、修改或删除，`oauth_creds.json` 也没被碰过。登录后条目结构不变，但 `id_token` 的声明集合会变化（这次多了 `name`、`picture`、`given_name`，数据从 1430 字节变为 1627 字节）。证据：`fixtures/agy/cred/logout-login-diff.json`。
- **文件回退（仅在 keyring 异常时）**：二进制字符串显示，keyring 写入失败或超时、最近出现过 keyring 超时（有 keyring marker 文件）、或检测到特定环境时，agy 改用文件存储 token；登出时 keyring 和文件都删。正常环境下的动态实录没有触发回退，回退文件路径未知。
- **登出方式**：交互模式输入 `/logout`，在补全菜单里回车后立即登出，没有确认提示，也没有子命令。交互模式首次启动会先走引导流程（配色方案、服务条款、信任目录），`cache/onboarding.json` 记录是否完成。
- **证据文件**：`fixtures/agy/cred/cred-probe.json`（静态探测）、`fixtures/agy/cred/logout-login-diff.json`（登出/登录动态差异），两者都不含任何凭据值；
- **对实现的影响**：
  - 模块 1.14：`wincredTargetPatterns = ["gemini:antigravity"]`，`credentialFiles = []`。`@napi-rs/keyring` 的 `new Entry(service, user)` 在 Windows 上默认 TargetName 是 `user.service`，**与 go-keyring 不一致**，必须用 `Entry.withTarget("gemini:antigravity", "gemini", "antigravity")` 按原 TargetName 读写，并用 UserName `antigravity` 写回。**只能用 `getSecret()` / `setSecret()` 按原始字节读写**：keyring-rs 在 Windows 上的 `setPassword()` 会按 UTF-16 编码存储，而 agy 写的是 UTF-8，用 `setPassword()` 恢复后 agy 将无法解析。快照按原始字节保存，不做解析和重新序列化。agy 运行期间会写回刷新后的 token，所以恢复和清空必须在持写锁、没有 agy 进程运行时进行；切走账号前要重新快照 live 条目，否则保存的 access_token 是旧的。
  - 模块 1.14 共用风险：切换 agy 账号会同时切换 IDE 的账号。IDE 运行时会随时把刷新后的 token 写回同一条目，可能在 restore 之后把旧账号写回去，从而覆盖切换结果。可选对策：切换前检测 `Antigravity.exe` 是否在运行并提示用户，restore 后隔几秒再读一次条目、核对 `id_token.sub`。
  - 模块 1.14 `clear()`：删除该条目，等价于 agy 自己的 `/logout`（已实录）。`isPresent()`：条目存在即为真。`credentialFiles` 保持为空（已实录）。只有 keyring 异常时才会走文件回退；若 restore 后 agy 仍在用旧账号，先排查这一点。
  - 账号识别：用 `id_token` 的 `sub` 作为账号唯一标识，`email` 用于显示；`name`、`picture` 等声明不一定存在。
  - 模块 1.17：refresh token 取自该条目 JSON 的 `token.refresh_token`。

### V8 · 环境变量覆盖下的账号隔离性
- **要探明的问题**：覆盖 `USERPROFILE`/`HOME`/`APPDATA` 环境变量能否实现完全独立的多账号并发运行；
- **探测方法**：模块 0.3 `isolation-test.ts`；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/isolation/`；
- **对实现的影响**：决定采用 `isolated_home` 模式还是降级为 `credential_snapshot` 模式。

### V9 · statusline 在 stream-json 模式下的回调行为
- **要探明的问题**：statusline 是否在无界面（stream-json）模式下被调用，传入字段结构；
- **探测方法**：模块 0.3 `statusline-capture.ts`；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/statusline/`；
- **对实现的影响**：决定模块 1.16 被动额度获取的可行性。

### V10 · 交互式 /usage 与登录流程伪终端输出
- **要探明的问题**：`/usage` 文本格式，登录流程的授权 URL 与完成标志；
- **探测方法**：模块 0.3 `pty-record.ts` 录屏；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/pty/`；
- **对实现的影响**：决定模块 1.15 登录状态机与模块 1.17 主动探针解析器。

### V11 · agy 版本与模型列表命令
- **要探明的问题**：`agy --version` 与 `agy models` 命令输出格式；
- **探测方法**：模块 0.3 `catalog-probe.ts`；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/catalog/`；
- **对实现的影响**：决定模块 1.13 `ModelCatalogPort` 的模型列表与运行模式解析。

### V12 · 额度接口（token 换取、loadCodeAssist、retrieveUserQuotaSummary）
- **要探明的问题**：1.17 调用额度接口所需的全部事实：token 从哪来、OAuth 客户端从哪来、接口地址、请求格式、返回结构、错误格式。
- **探测方法**（2026-09-29 02:50，本机 agy 1.2.12，Windows x64，经本机 HTTPS 代理）：`npx tsx tools/discover/quota-probe.ts --out-dir fixtures/agy/quota`。脚本只读取凭据，在内存中脱敏并通过泄漏自检后才落盘；OAuth 客户端只在内存中使用，不写盘。每个接口成功场景调用 1 次（`retrieveUserQuotaSummary` 分别用带 `project` 与空请求体各调 1 次），另录两个失败场景。请求格式（地址、请求体、User-Agent 写法）参照 agy-auto `src/usage.js`，结论以实录为准。
- **证据文件**（`fixtures/agy/quota/`，每个文件含方法、URL、脱敏后的请求头与请求体、状态码、响应头名列表与部分响应头值、脱敏后的响应体、耗时）：
  - `probe-meta.json`：探测环境、凭据与 OAuth 客户端来源（不含值）、各次调用状态与耗时、各响应的字段结构、脱敏规则
  - `token-refresh.json`、`token-refresh-wrong-client-secret.json`、`token-refresh-invalid-grant.json`
  - `load-code-assist.json`
  - `quota-summary.json`（请求体带 `project`）、`quota-summary-empty-body.json`（请求体 `{}`）
  - `quota-unauthorized.json`
  - 脱敏占位符：`<redacted:access_token>`、`<redacted:refresh_token>`、`<redacted:id_token>`、`<redacted:client_id>`、`<redacted:client_secret>`、`<redacted:project>`、`<redacted:email-user>`（邮箱保留域名）。额度数值、桶标识、时间戳、tier 名称保留原值。

#### 1. 实录事实

**鉴权**
- **token 来源**：Windows 凭据管理器 `gemini:antigravity` 条目 JSON 的 `token.refresh_token`（与 V7 一致）。条目中的 `token.access_token` 与 `token.expiry` 也可直接使用；本次探测时存量 access token 仍有效（剩余超过 60 秒），但仍按设计用 refresh token 重新换取。
- **换 token**：`POST https://oauth2.googleapis.com/token`，`Content-Type: application/x-www-form-urlencoded`，字段 `client_id`、`client_secret`、`refresh_token`、`grant_type=refresh_token`。返回 200，字段 `access_token`、`expires_in`（3599）、`scope`、`token_type`（`Bearer`）、`id_token`。`scope` 实录值为 `aicode`、`cclog`、`cloud-platform`、`userinfo.profile`、`openid`、`experimentsandconfigs`、`userinfo.email`。响应中**没有**新的 `refresh_token`，原 refresh token 继续有效。
- **换 token 不写回凭据**：探测前后用 Win32 `CredRead` 核对条目，数据长度（1625 字节）、Persist（2）与最后写入时间（02:49:44）均未变化。
- **OAuth 客户端来源**：agy 程序（`%LOCALAPPDATA%\agy\bin\agy.exe`）中以 latin1 扫描到 **2 个** `*.apps.googleusercontent.com` client_id 候选和 **2 个** `GOCSPX-*` secret 候选。client_id 取与 live `id_token.aud` 相同者；secret 按首次出现顺序尝试：**第 1 个返回 401 `{"error":"invalid_client","error_description":"The provided client secret is invalid."}`，第 2 个成功**。具体值不记录。
- **access token 用法**：`Authorization: Bearer <access_token>`，`Content-Type: application/json`。本次 User-Agent 为 `antigravity/1.2.12 win32/x64`（未验证服务端是否校验 UA）。

**`POST https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`**
- 请求体 `{"metadata":{"ideType":"ANTIGRAVITY"}}`；200，约 1.4 秒。
- 顶层字段：
  - `currentTier`：`{ id, name, description, privacyNotice{showNotice,noticeText}, upgradeSubscriptionUri, upgradeSubscriptionText, upgradeSubscriptionType }`，实录值 `id: "free-tier"`、`name: "Antigravity"`、`upgradeSubscriptionType: "GOOGLE_ONE"`。`upgradeSubscriptionUri` 中含 URL 编码的账号邮箱（已脱敏）。
  - `allowedTiers[]`：实录两项，`free-tier`（`isDefault: true`）与 `standard-tier`（`userDefinedCloudaicompanionProject: true`、`usesGcpTos: true`）。
  - `cloudaicompanionProject`：**字符串**（项目 id，已脱敏）。
  - `gcpManaged`：`false`。
  - `upgradeSubscriptionUri`：字符串。
  - `paidTier`：**对象**（不是数组）`{ id, name, description, upgradeSubscriptionUri, upgradeSubscriptionText }`，实录 `id: "g1-pro-tier"`、`name: "Google AI Pro"`。
- 结论：用户可见的套餐名在 `paidTier.name`；`currentTier.name` 实录是产品名 `Antigravity`，不是套餐名。

**`POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`**
- 请求体 `{"project":"<cloudaicompanionProject>"}` 与 `{}` **都返回 200，内容相同**（同一时刻各调一次，约 0.3–0.5 秒）。
- 返回结构：
  ```text
  {
    description: string                       // 面板说明文字
    groups: [{
      displayName: string                     // "Gemini Models" | "Claude and GPT models"
      description: string                     // "Models within this group: Gemini Flash, Gemini Pro"
      buckets: [{
        bucketId: string                      // 桶标识
        displayName: string                   // "Weekly Limit Remaining" | "Five Hour Limit Remaining"
        window: string                        // "weekly" | "5h"
        resetTime: string                     // UTC RFC3339，Z 结尾、无小数，如 "2026-10-05T14:07:13Z"
        description: string                   // 如 "You have used some of your 5-hour limit, it will fully refresh in 54 minutes."
        remainingFraction: number             // 剩余比例 0–1，如 0.9031425
      }]
    }]
  }
  ```
- 实录的分组与桶：

  | 分组 `displayName` | `bucketId` | `window` | `remainingFraction` | `resetTime` |
  |---|---|---|---|---|
  | Gemini Models（Gemini Flash, Gemini Pro） | `gemini-weekly` | `weekly` | 0.9838571 | 2026-10-05T14:07:13Z |
  | Gemini Models | `gemini-5h` | `5h` | 0.9031425 | 2026-09-28T20:17:43Z |
  | Claude and GPT models（Claude Opus, Claude Sonnet, GPT-OSS） | `3p-weekly` | `weekly` | 0.1893564 | 2026-10-04T09:57:19Z |
  | Claude and GPT models | `3p-5h` | `5h` | 0.2974208 | 2026-09-28T19:45:35Z |

- 本次实录中**没有** `disabled` 字段，也没有标题字段（面板标题 "Model Quotas" 不在响应里）。没有 AI Credits 相关字段。

**错误格式**
- 无效 access token 调 `retrieveUserQuotaSummary`：401，响应头 `www-authenticate: Bearer realm="https://accounts.google.com/", error="invalid_token"`，响应体 `{"error":{"code":401,"message":"Request had invalid authentication credentials. ...","status":"UNAUTHENTICATED"}}`（Google API 标准错误格式）。
- 无效 refresh token 换 token：400，`{"error":"invalid_grant","error_description":"Bad Request"}`。
- client_secret 不匹配：401，`{"error":"invalid_client","error_description":"The provided client secret is invalid."}`。
- 响应头中有 `x-cloudaicompanion-trace-id`（值未记录）；成功与失败响应都没有 `retry-after`。

**事故记录（2026-09-29，同样影响 1.14）**
- 脚本初版用 `@napi-rs/keyring` 2.1.0 读取条目，导致用户凭据两次被清空。在已经为空的条目上逐项实测：**仅调用 `Entry.withTarget("gemini:antigravity","gemini","antigravity")` 就会把条目覆盖为 0 字节数据、Persist=3（企业级）**，与该库文档中“只创建对象”的描述不符；`agy --version` 不会写入。agy 自己登录后写入的条目是 Persist=2，可用于区分写入方。
- 现版脚本改为通过 PowerShell 调用 Win32 `CredReadW`，实测不改变条目的最后写入时间。

#### 2. 参考 agy-auto 的解读（未经本机实录证实）
- `bucketId` 与官方 statusline `quota` 映射的键一致（`gemini-weekly`、`gemini-5h`、`3p-weekly`、`3p-5h`），`groups` 与官方 `/usage` 面板、Models 文档的分组一一对应（本次实录的 ID 与之吻合，但 statusline 本身未实录）。
- 桶可能带 `disabled: true`（agy-auto 注释：周额度耗尽时 5 小时桶被禁用，此时有效剩余按 0 处理）。本次所有桶都未耗尽，无法证实。
- agy-auto 在 `loadCodeAssist` 失败时忽略错误，直接用空请求体查额度；本次实录说明空请求体确实可用。
- agy-auto 的套餐名取 `currentTier.name || currentTier.id || paidTier[0].name`：按本次实录会得到 `Antigravity`，而 `paidTier` 实为对象，`paidTier[0]` 取不到值。**与实录不符**，1.17 应取 `paidTier.name`，缺失时再退回 `currentTier.name`。
- agy-auto 按固定数字前缀选 client_id（与本次 `id_token.aud` 一致），但 secret 取首次出现的第 1 个，本次实录第 1 个返回 `invalid_client`。**推断**：在 agy 1.2.12 上照搬 agy-auto 的写法会换 token 失败（除非通过环境变量或其缓存文件提供正确的 client）。
- agy-auto 只调用 token、`loadCodeAssist`、`retrieveUserQuotaSummary` 三个接口，没有调用 `fetchAvailableModels` 等其他接口，本次也未录其他接口。

#### 3. 对实现的影响（模块 1.17）
- `oauth-client.ts`：从 agy 程序中扫描全部 client_id / secret 候选（只放内存）；client_id 取与 live `id_token.aud` 相同者；secret 逐个尝试，`invalid_client` 时换下一个，成功后在内存中记住这一对。不要硬编码 client_id 前缀，也不要写盘。
- `quota-api.ts`：
  - 读取 live 凭据**只能用 Win32 `CredReadW`（或等价的纯读取 API），不能用 `@napi-rs/keyring`**。条目存在但为 0 字节时视为未登录，返回 `unavailable`。
  - 换 token 按上方格式；按 `expires_in` 在内存中缓存，过期前 60 秒刷新。换 token 不会改写条目，也不返回新的 refresh token，不需要写回。
  - 额度请求：`POST retrieveUserQuotaSummary`，请求体 `{}` 即可；需要套餐名时再调 `loadCodeAssist` 取 `paidTier.name`（可低频缓存）。
  - 解析：`groups[].displayName/description/buckets[]` 直接映射到 `QuotaGroup`；桶的 `bucketId`、`displayName`、`window`、`remainingFraction`、`resetTime`、`description` 一一对应 `QuotaBucket`；`disabled` 缺失时为 `false`；`resetInSeconds` 由 `resetTime` 计算；`description` 映射到 `QuotaSnapshot.description`；`title` 固定为 `Model Quotas`。`window` 只接受 `weekly` / `5h`，出现其他值时保留原始桶但不要让整个解析失败。
  - 错误处理：401 `UNAUTHENTICATED` → 丢弃内存中的 access token，重新换一次再试；换 token 返回 400 `invalid_grant` → refresh token 已失效，标记 `unavailable`（需要用户重新登录），不要重试；401 `invalid_client` → OAuth 客户端失效（多半是 agy 升级），标记 `unavailable`。
- `profile.quota` 需要补充：`tokenUrl`、`loadCodeAssistUrl`、`quotaSummaryUrl`、`ideType: "ANTIGRAVITY"`、User-Agent 模板、OAuth 客户端提取规则（正则与按 `aud` 选择）。
- **风险**：
  - 这些都是非公开的 `v1internal` 接口（域名为 `daily-cloudcode-pa`），字段和地址随时可能变化，1.17 必须对未知字段宽容、对缺失字段降级为 `unavailable`。
  - 调用需要 agy 内置的 OAuth client secret；agy 升级后候选的数量、顺序或值可能变化。
  - 本次只录到一个账号（免费 tier + Google AI Pro 付费 tier）、所有桶都未耗尽的状态；`disabled` 桶、额度耗尽、其他套餐的返回形态未实录。
  - 未验证服务端是否校验 User-Agent 或 `ideType`。
