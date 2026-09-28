# AGY Studio · 阶段 0 环境探测脚本套件说明文档

本目录包含了用于阶段 0 黑盒环境探测（清单 V5–V11）的独立探测工具集。
探测遵循架构设计核心原则：**零移植**（一切知识仅来自官方文档和实际探测结果）、**不碰私有凭据内容**、**隔离防腐**。

---

## 目录结构

| 文件 | 对应清单 | 职责 |
|---|---|---|
| `rollback.ts` | 安全机制 | 提供通用的自动配置备份、环境变量与临时文件回滚（Rollback）逻辑 |
| `catalog-probe.ts` | V11 | 探测 `agy --version`、模型列表命令与可选 `mode` |
| `fs-diff.ts` | V5, V6 | 对用户主目录与 AppData 做文件快照差异对比，排除浏览器/临时目录噪音 |
| `cred-diff.ts` | V7 | 执行 `cmdkey /list` 前后对比，安全提取新增凭据 Target 名称（严禁记录内容） |
| `isolation-test.ts` | V8 | 覆盖 `USERPROFILE`/`HOME`/`APPDATA`/`LOCALAPPDATA`，判断数据与凭据落盘位置 |
| `statusline-capture.ts` | V9 | 临时注入 statusline 命令，探测无界面与交互模式下 statusline 回调及参数 |
| `pty-record.ts` | V10 | 基于伪终端录制 `/usage`、`/credits` 控制台交互与登录授权流，输出原始与脱敏文本 |

---

## 推荐探测执行顺序

建议按以下由浅入深、先无副作用后有交互的顺序执行：

### 第一步：元数据探测（清单 V11）
探明本机安装的 agy 路径、版本号、模型列表与支持的 mode。
```powershell
npx tsx tools/discover/catalog-probe.ts --out fixtures/agy/catalog/catalog-probe.json
```

### 第二步：文件系统快照差异（清单 V5、V6）
在执行测试操作前记录快照，并在执行 agy 会话后再次对比，确认会话、settings 与 transcript 所在目录。
```powershell
# 1. 记录初始快照
npx tsx tools/discover/fs-diff.ts snapshot --out fixtures/agy/fs/snap-before.json

# 2. 执行一轮 agy 命令（如 agy --prompt "hello" --print）

# 3. 记录后置快照并输出差异
npx tsx tools/discover/fs-diff.ts snapshot --out fixtures/agy/fs/snap-after.json
npx tsx tools/discover/fs-diff.ts diff --before fixtures/agy/fs/snap-before.json --after fixtures/agy/fs/snap-after.json --out fixtures/agy/fs/fs-diff.json
```

### 第三步：凭据存储位置安全探测（清单 V7）
探明 agy 登录后凭据是保存在 Windows 凭据管理器，还是磁盘文件中。
```powershell
# 交互模式：脚本会记录初始快照，提示您完成登录操作，回车后输出新增凭据 Target
npx tsx tools/discover/cred-diff.ts run --interactive --out fixtures/agy/fs/cred-diff.json
```
> **安全红线**：此脚本仅输出凭据条目 Target 标识，严禁打印或存储任何密码与 Token。

### 第四步：环境变量隔离性验证（清单 V8）
验证重定向 `USERPROFILE` 等环境变量后，agy 是否完全落盘于隔离沙箱内。
```powershell
npx tsx tools/discover/isolation-test.ts --cmd "agy --version" --out fixtures/agy/fs/isolation-report.json
```
若需要人工审查沙箱内部生成的文件夹结构，可附加 `--keep` 参数保留沙箱临时目录。

### 第五步：Statusline 状态栏捕获（清单 V9）
验证无界面（stream-json）模式下 statusline 是否仍会被触发，并记录其输入 JSON。
```powershell
# 探测无界面 stream 模式与交互模式回调
npx tsx tools/discover/statusline-capture.ts --mode both --out fixtures/agy/statusline
```
> **安全说明**：脚本会在运行前自动备份原始 `settings.json`，在探测结束、按 Ctrl+C 或发生任何异常时**强制自动 Rollback 还原**。

### 第六步：伪终端与交互/登录流录制（清单 V10）
在伪终端中运行 `/usage`、`/credits` 与 `login` 命令，录制控制台原始与脱敏回显文本。
```powershell
# 录制配额查询交互
npx tsx tools/discover/pty-record.ts usage --out fixtures/agy/pty

# 录制登录流程与授权提示
npx tsx tools/discover/pty-record.ts login --out fixtures/agy/pty
```

---

## 运行单元测试与校验

探测套件内的安全备份恢复机制与各数据解析器具备完备的自动化单元测试：
```powershell
# 运行环境探测套件单元测试
npx vitest run tools/discover/

# 全局类型检查
npm run typecheck
```
