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
| **V5** | agy 在磁盘上的目录布局：会话、transcript、artifacts、截图、录屏分别在哪 | *待模块 0.3 探测* | `fixtures/agy/fs/` | 模块 1.5, 1.10：决定数据根目录定位、会话导入与 Artifacts 实时追踪路径。 |
| **V6** | settings 文件的位置（全局、工作区）以及"总是放行"对应的键名和取值 | *待模块 0.3 探测* | `fixtures/agy/settings/` | 模块 1.7：实现 `SettingsPort.ensureAlwaysProceed`，保证 L2 兜底写入准确性。 |
| **V7** | 登录凭据存在哪：Windows 凭据管理器的哪些条目、还是哪些文件 | *待模块 0.3 探测* | `fixtures/agy/cred/` | 模块 1.14：确定凭据快照目标（keyring 条目或磁盘文件）及加密保存方案。 |
| **V8** | 覆盖 `USERPROFILE` / `HOME` / `APPDATA` / `LOCALAPPDATA` 后启动 agy，是否会使用独立的凭据与数据目录 | *待模块 0.3 探测* | `fixtures/agy/isolation/` | 模块 1.14：决定采用 `isolated_home`（优先）还是 `credential_snapshot`（降级）多账号模式。 |
| **V9** | statusline 是否在无界面（stream-json）模式下也会被调用；传入的 JSON 字段（额度、邮箱、套餐、上下文用量） | *待模块 0.3 探测* | `fixtures/agy/statusline/` | 模块 1.16：确定被动额度推送在无界面运行时的可用性与解析映射。 |
| **V10** | 交互模式下 `/usage`、`/credits` 的输出格式；登录流程的命令、授权链接格式、成功标志 | *待模块 0.3 探测* | `fixtures/agy/pty/` | 模块 1.15, 1.17：决定伪终端登录流程状态机与主动额度探针解析规则。 |
| **V11** | `agy --version`、`agy models` 的输出格式；mode 的可选值 | *待模块 0.3 探测* | `fixtures/agy/catalog/` | 模块 1.13：确定模型列表、运行模式、版本检测解析逻辑。 |

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
- **探测方法**：模块 0.3 `cred-diff.ts` 对比登录前后凭据变化；
- **结论**：*待模块 0.3 填入*；
- **证据文件**：`fixtures/agy/cred/`；
- **对实现的影响**：决定模块 1.14 `CredentialPort` 的快照与恢复实现。

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
