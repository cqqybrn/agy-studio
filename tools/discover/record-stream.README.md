# Stream 录制工具指南（tools/discover/record-stream.README.md）

`record-stream.ts` 用于录制真实 Antigravity CLI（`agy`）在 `stream-json` 输入输出模式下的完整通信流，生成供后续模块（`stream-schema`、`stream-adapter`、`fake-agy`）使用的脱敏标准测试用例集（Fixtures）。

---

## 一、运行前提与环境说明

1. **环境准备**：
   - 本机已安装 Antigravity CLI（`agy`）并在 `PATH` 中可直接执行；
   - Node.js ≥ 20；
   - 官方文档参考：[https://antigravity.google/docs](https://antigravity.google/docs)。

2. **参数规范**：
   ```bash
   npx tsx tools/discover/record-stream.ts --scenario <name> (--prompt <text> | --turns <file>) [选项]
   ```
   - `--scenario <name>`：[必填] 场景标识，录制结果存入 `fixtures/agy/stream/<scenario>/`
   - `--prompt <text>`：用户输入提示词（单轮或作为多轮的首轮）
   - `--turns <file>`：多轮对话输入文件路径（每行一轮输入）
   - `--cwd <dir>`：工作目录（默认当前目录）
   - `--model <model>`：指定模型（传递给 `agy --model`）
   - `--abort-after-ms <ms>`：设定毫秒后强制终止进程树（用于录制中断场景）
   - `--extra-args <args>`：传递给 agy 的额外参数（如 `--effort high`）
   - `--frame-template <template>`：自定义 user 帧 JSON 模板（默认官方标准格式）

3. **数据脱敏**：
   脚本在写入磁盘前会自动执行以下脱敏规则：
   - 邮箱地址替换为 `[REDACTED_EMAIL]`；
   - 用户主目录（`USERPROFILE`、`HOME`、`APPDATA`、`LOCALAPPDATA`）替换为 `<HOME>`；
   - 疑似 Token / 秘钥（OAuth Token、API Key、JWT、Bearer）替换为 `[REDACTED_TOKEN]`；
   - 保留 UUID 格式的会话 ID，以确保事件流回放与适配器测试的关联性。

4. **产出规范**：
   每个场景生成目录 `fixtures/agy/stream/<scenario>/`：
   - `stdout.jsonl`：每行一个事件对象，附加 `offsetMs`（相对启动时间的毫秒时间戳）；
   - `stderr.txt`：标准错误输出；
   - `meta.json`：记录命令、agy 版本、参数配置、耗时、退出码与信号。

---

## 二、9 个典型场景运行命令与观察点

### 1. 场景一：纯对话（`simple-chat`）
- **场景目的**：验证最基础的流式问答，探明 `init`、`step_update`、`result` 事件的基本结构与 token 统计。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario simple-chat --prompt "你好，请用一句话介绍你自己"
  ```
- **核心观察点**：
  - `init` 对象的 `tools` 列表与 `permission_mode`；
  - `step_update` 中 `state: "ACTIVE"` 和 `state: "DONE"` 的流转；
  - `text_delta` 是否按字符/词片段逐步产出；
  - `result` 中的 `status: "SUCCESS"` 与 `usage` 中的 `thinking_tokens` 计数。

---

### 2. 场景二：读写文件（`file-ops`）
- **场景目的**：观察写文件和读文件工具调用在 stream 中的事件表示，确认跳过权限后的无交互执行。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario file-ops --prompt "在当前目录下创建一个 test-hello.txt 文件，写入 'hello agy'，读取其内容，然后将该文件删除"
  ```
- **核心观察点**：
  - 工具调用事件类型（`write_to_file`、`view_file`、`run_command`）；
  - `step_update` 是否包含工具调用入参与返回值；
  - 在 `--dangerously-skip-permissions` 下是否有任何中间确认拦截（预期直接执行完成）。

---

### 3. 场景三：执行系统命令（`command-exec`）
- **场景目的**：探明 shell 命令调用（`run_command`）在流中的输出表现，为终端卡片渲染提供数据源。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario command-exec --prompt "执行命令 git --version 并告诉我结果"
  ```
- **核心观察点**：
  - `run_command` 工具的参数格式（命令字符串、工作目录）；
  - 命令的标准输出/错误在流中是作为工具结果整体返回还是增量返回；
  - 确认执行命令过程未受系统权限弹窗阻断。

---

### 4. 场景四：派生子 Agent（`subagent`）
- **场景目的**：探索主 agent 派生子 agent（如 researcher 等）时流中的事件特征，验证子 agent 追踪契约。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario subagent --prompt "请启动一个子 agent 去调查当前目录下的 package.json 文件，并总结依赖项给你"
  ```
- **核心观察点**：
  - 是否产生 `invoke_subagent` 或 `define_subagent` 工具调用；
  - 是否包含子 conversation 的独立 ID；
  - 子 agent 的思考与步骤是在主流中返回，还是仅在主会话汇总返回结果。

---

### 5. 场景五：额度耗尽与异常处理（`quota-exhausted`）
- **场景目的**：探测认证失败、模型不存在或额度受限时的错误事件格式，确保系统鲁棒性。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario quota-exhausted --prompt "测试异常处理" --extra-args "--model invalid-model-test-xyz"
  ```
- **核心观察点**：
  - `result` 事件中的 `status` 是否为 `"ERROR"`；
  - `result.error` 字符串或对象的结构；
  - 进程退出码是否为非零（如 1）。

---

### 6. 场景六：带图片路径注入（`image-path`）
- **场景目的**：验证 user 输入携带图片时的路径注入机制与原生图片块失败行为（探测 V4）。
- **运行命令（测试路径注入）**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario image-path --prompt "请查看这张图片并描述其可能的内容：docs/example.png"
  ```
- **运行命令（验证原生 image block 被拒绝）**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario image-block-fail --prompt "test" --frame-template "{\"event\":\"user\",\"message\":{\"content\":[{\"type\":\"image\"}]}}"
  ```
- **核心观察点**：
  - 原生 `type: "image"` 帧被 CLI 明确拒绝：`error: stream input content block type "image" is not supported (only "text")`；
  - 在 prompt 中注入图片绝对/相对路径后，agent 能够通过文件读取工具识别并处理。

---

### 7. 场景七：中途中止（`abort-midway`）
- **场景目的**：测试用户主动点击停止时，进程被强制终止（`killProcessTree`）后的截断与清理行为。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario abort-midway --prompt "请写一篇包含 5000 字的长篇技术论文，详细解释分布式一致性算法 Raft" --abort-after-ms 2500
  ```
- **核心观察点**：
  - 进程树在 2500ms 时被及时终止；
  - `meta.json` 中 `aborted` 标记为 `true`；
  - `stdout.jsonl` 保留了终止前接收到的完整事件，无半行残缺损坏；
  - 验证 Windows 下 `taskkill /F /T` 能够干净释放子进程。

---

### 8. 场景八：多轮连续输入（`multi-turn`）
- **场景目的**：验证单进程通过 stdin 连续交互的可行性（探测 V1）。
- **准备轮次文件（`tools/discover/fixtures-input/multi-turn.txt`）**：
  ```text
  请记住数字 9527，不要输出多余解释，只回复收到
  刚才让你记住的数字是多少？
  ```
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario multi-turn --turns tools/discover/fixtures-input/multi-turn.txt
  ```
- **核心观察点**：
  - 第一轮输出 `result`（`num_turns: 1`）后，进程保持活跃；
  - 第二轮发送后，`step_index` 连续递增；
  - 第二轮正确回答包含 `9527`；
  - 所有轮次完成后进程以退出码 0 正常退出。

---

### 9. 场景九：访问工作区外路径（`outside-workspace`）
- **场景目的**：验证当 agent 尝试访问当前工作区外的文件系统时，权限跳过参数的行为与安全边界。
- **运行命令**：
  ```bash
  npx tsx tools/discover/record-stream.ts --scenario outside-workspace --prompt "请读取 C:\Windows\win.ini 文件的首行内容"
  ```
- **核心观察点**：
  - agy 是否允许跨越工作区边界执行读取；
  - 工具返回结果中是否包含工作区外安全警告或错误；
  - 流中是否出现关于工作区外部访问的权限事件。

---

## 三、下游消费衔接

录制产物位于 `fixtures/agy/stream/<scenario>/`：
1. **模块 0.4（`fake-agy`）**：按 `stdout.jsonl` 中的 `offsetMs` 进行精确时间戳回放；
2. **模块 1.4（`stream-schema` & `stream-adapter`）**：对 `stdout.jsonl` 进行纯函数解析并做快照测试；
3. **`docs/VERIFY.md`**：记录探测结论并作为技术决策的事实依据。
