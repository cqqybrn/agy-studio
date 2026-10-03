# AGY Studio

<div align="center">

**一个复刻 Antigravity Agent 界面的本地 WebUI**

*底层直接调用本机 `agy` CLI · 敏感操作强制自动同意 · 思考过程与子 Agent 嵌套展开 · Artifacts 联动 · 额度面板与多账号无缝切换*

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue.svg)](https://microsoft.com)

</div>

---

## 📖 项目简介与核心定位

**AGY Studio** 是专为 **Antigravity CLI (`agy`)** 打造的生产级本地 Web 客户端。

在原生 CLI 或 IDE 插件环境下，许多开发者常常遇到 **"Always Proceed" 设置失效、耗时较长的自动化长任务频频被权限确认弹窗阻断** 的痛点，导致无法脱手离开屏幕。

AGY Studio 旨在彻底解决这一体验瓶颈：
- **解决阻断**：采用**强制自动同意四层兜底机制**，让编码、测试与重构流水线一气呵成；
- **全方位视觉复刻**：深度还原官方 Antigravity 界面交互体验，清晰呈现主会话思考流（Thinking Process）、多级子 Agent 调用树与耗时统计；
- **任务产物聚合**：支持 Implementation Plan、Walkthrough、截图与录屏等 Artifacts 实时高亮与预览；
- **安全与控制底线**：引入**影子 Git（Shadow Git）无感快照**，在执行危险指令前建立检查点，提供随时一键 diff 与安全回滚能力。

---

## ✨ 核心功能与亮点

1. **流畅对话与思考全展开**
   - 完整捕获模型思维链（Thinking Process），展开折叠自由切换。
   - 动态嵌套渲染子 Agent（Subagent）执行流程，步骤计时与细节一目了然。
   - 工具调用（文件读写、终端命令、搜索等）结构化卡片展示，未知输出平滑降级，绝不断流。
2. **强制自动同意四层兜底体系（Zero-Stall Pipeline）**
   - **L1 参数强制放行**：启动命令强制携带 `--dangerously-skip-permissions`。
   - **L2 配置文件同步**：原子化自动校准并写入 `settings.json`（`toolPermission: always-proceed`）。
   - **L3 权限事件截获**：流中若仍冒出权限确认帧，runner 层毫秒级直接回填确认。
   - **L4 卡死巡检看门狗**：针对无响应状态实现心跳看门狗检测，长命令自动放宽时限，防止进程僵死。
3. **Artifacts 与任务产物面板**
   - 自动追踪数据目录下的任务清单、实施规划（Implementation Plan）、总结报告（Walkthrough.md）以及生成的媒体产物。
   - 支持划词评论反哺上下文，实时预览与一键定位变更。
4. **影子 Git 检查点（Checkpoints）与一键回滚**
   - 每次 Agent 运行前，后台基于工作区创建隐式影子 Git 检查点（完全隔离于项目本身的 `.git`）。
   - 提供直观的文件变更差异对比（Diff 查看），遇到破坏性误操作可一键瞬间回滚。
5. **额度透视与多账号无损切换**
   - 顶栏常驻环形额度进度条，直观反映当前账号的 Weekly 额度与 5h 动态用量。
   - 采用 Windows DPAPI 本地数据保护加密技术备份凭据快照，支持无缝切换与管理多个 Google/Antigravity 账号，隔离并发租约，防止凭据串扰。
6. **附件与多模态扩展**
   - 支持粘贴截图、拖拽图片及多格式文档（PDF / Word / Excel 服务端智能提取并注入 Prompt 路径）。

---

## 💻 系统环境要求

- **操作系统**：Windows 10 / Windows 11 (x64)
- **Node.js**：版本 **≥ 20.0.0**（建议使用最新 LTS 版本）
- **Antigravity CLI**：已在本机安装并成功登录 `agy`
  - 官方文档与安装指南：[https://antigravity.google/docs](https://antigravity.google/docs)
  - 验证命令：在终端运行 `agy --version`，确保可正确返回版本号。

---

## 🚀 安装与快速启动

### 方式一：一键双击启动（推荐 Windows 用户）

1. 下载或克隆本项目到本地。
2. 在项目根目录下，直接双击运行 **`start.cmd`** 脚本。
3. 脚本会自动进行环境检测：
   - 校验 Node.js 版本（≥ 20）；
   - 检查 `agy` CLI 探测路径；
   - 首次运行时自动执行依赖安装与前端预编译构建；
   - 启动后端服务，并在端口就绪后**自动调用默认浏览器**打开：
     ```text
     http://127.0.0.1:8790
     ```

### 方式二：命令行手动启动

```bash
# 1. 安装项目所有依赖
npm install

# 2. 构建前端生产产物
npm run build -w frontend

# 3. 启动后端主服务
npx tsx backend/src/main.ts
```

启动完成后，使用浏览器访问 `http://127.0.0.1:8790` 即可开始使用。

---

## 🎯 首次使用流程

1. **导入/确认当前账号**
   - 首次打开 AGY Studio 时，若系统已在原生环境登录过 `agy`，Studio 会自动感知当前活跃账号。
   - 亦可点击右上角头像呼出**账号管理面板**，点击“添加账号”，Studio 将唤起系统终端供您完成官方 OAuth 鉴权，并在登录成功后以 DPAPI 本地加密存储该快照。
2. **选择或添加工作区（Workspace）**
   - 在左侧侧边栏点击“添加工作区”，指定本机代码工程所在目录。
   - Studio 将以该目录作为 Agent 执行的根上下文。
3. **开启新会话（New Session）**
   - 选择所需模型（如 Gemini 2.5 Flash / Pro）、推理级别（Effort）与执行模式。
   - 输入您的提示词或拖入需求文件/需求文档，开启丝滑的无阻断自动化开发体验！

---

## 🔒 局域网与手机访问指南（安全红线）

> ⚠️ **高危安全警示**：
> AGY Studio 开启了强制自动放行权限，**获得该 Web 访问权即意味着拥有在本机执行任意代码和读写磁盘文件的等同权限**。

1. **默认安全策略**
   - 服务默认仅监听本机回环地址（`127.0.0.1:8790`），此模式下免鉴权，确保本机便捷体验。
2. **局域网或手机设备访问配置**
   - 当需要使用手机在内网或沙发上查看任务执行进度时，**必须显式配置访问鉴权令牌 `AGY_STUDIO_TOKEN`**，并指定监听网卡（如 `HOST=0.0.0.0`）：
     ```cmd
     set HOST=0.0.0.0
     set PORT=8790
     set AGY_STUDIO_TOKEN=your-very-strong-and-secret-token
     start.cmd
     ```
   - 启动后，后端将严苛执行鉴权拦截：
     - 若 `HOST` 不是回环地址且未设置 `AGY_STUDIO_TOKEN`，后端将**直接拒绝启动**以保护系统安全；
     - Web 端与 WebSocket 建立连接时需在 URL 中追加 `?token=your-token` 或通过 Header 认证。
3. **推荐网络方案**
   - **强烈建议使用 [Tailscale](https://tailscale.com/) 等点对点加密组网工具**建立安全访问信道，监听 Tailscale 分配的内网 IP。
   - **严禁将未加鉴权保护的端口直接映射暴露至公网（如路由器公网端口映射、无防护的内网穿透）！**

---

## 🛡️ 自动同意四层兜底与安全防护机制

为了在“无阻断极速执行”与“代码安全保障”之间取得最佳平衡，AGY Studio 实现了严密的防御架构：

### 1. 自动同意的运行逻辑
- **层层递进**：优先通过原生命令行参数 `--dangerously-skip-permissions` 请求全放行；
- **配置持久化防御**：在会话启动前后检查工作区与用户级配置，避免因 IDE 切换导致 `toolPermission` 被重置；
- **协议层回填**：对于极少数顽固的交互确认提示，适配器在事件总线层拦截并自动回传同意响应；
- **状态超时看门狗**：一旦侦测到既无输出又无命令退出的假死挂起，看门狗会尝试注入回车唤醒，二次超时则优雅标记异常，拒绝无限期耗电挂死。

### 2. 影子 Git（Shadow Git）与一键回滚
- **工作机制**：AGY Studio 维护独立于项目本身 Git 的影子对象库（位于数据目录中）。
- **快照时机**：每次调用 Agent 发起任务前，系统自动以非阻塞方式为整个工作区拍下增量快照。
- **安心回滚**：如果 Agent 执行过程中写坏了代码或删错了配置文件，随时可以在“检查点（Checkpoints）”面板中对比变更差异（Diff），一键安全无损撤回。

---

## 🔄 “agy 升级后”的维护与探测步骤

当 Google 官方更新了 `agy` CLI，或者其输出事件结构、默认模型、参数配置发生变动时，无需重构业务层代码，只需按如下标准三步更新工程：

```bash
# 步骤 1：运行阶段 0 探测工具，重新对本机 agy 行为进行黑盒探测
npm run test -w tools/discover
# 或单独运行录制/捕获工具（如 quota-probe、record-stream 等）

# 步骤 2：更新 backend/agy-profile.json
# 将探测产出的最新事件格式、CLI 参数结构与路径规约写入 backend/agy-profile.json 与相关 fixtures 测试快照

# 步骤 3：运行测试套件验证兼容性
npm run test
```

- **架构优势**：AGY Studio 严格遵循**端口与适配器设计原则**。业务逻辑与外部细节完全隔离，所有与版本紧密相关的定义统一由 `agy-profile.json` 声明。即使遇到尚未识别的未知新事件，适配器也会自动降级包装为 `raw` 事件，绝不抛出未捕获异常导致流断裂。

---

## ❓ 常见问题排查（FAQ）

### Q1: 运行 `start.cmd` 提示端口被占用？
- **排查**：默认端口为 `8790`。若被其他软件占用，可通过设置 `PORT` 环境变量启动：
  ```cmd
  set PORT=9000
  start.cmd
  ```

### Q2: 提示“未检测到 agy CLI”或“agy: command not found”？
- **排查**：
  1. 请先确认是否已安装 Antigravity CLI 并在系统终端中能够正常键入 `agy`；
  2. 若已安装但未加入系统全局 PATH（如位于特定软件目录或自定义开发环境），可在启动前配置 `AGY_BIN` 绝对路径：
     ```cmd
     set AGY_BIN=D:\tools\antigravity\agy.exe
     start.cmd
     ```

### Q3: 额度面板显示“不可用”或“连接超时”？
- **排查**：
  1. 额度查询通过官方受保护接口低频拉取。若使用了系统级代理（VPN/梯子），Node 环境默认可能不走代理，AGY Studio 已在 `backend/src/main.ts` 中内置注入全局环境变量代理适配；请确认网络能否正常访问 Google 认证域名；
  2. 若账号凭据过期，可在账号管理中重新点击登录刷新凭据快照。

### Q4: 提示 Node.js 模块或 contracts 找不到？
- **排查**：
  - 本项目为 Monorepo 架构，在仓库根目录下运行一次 `npm install` 即可自动建立 workspaces 内部符号链接。

### Q5: 点击登录提示“无法连接 Google 登录服务”，或登录窗口里一直转圈？
- **原因**：`agy` 只读取 `HTTPS_PROXY` 环境变量，**不会使用** Windows 系统代理（浏览器用的那个）。因此即使浏览器能打开授权页，`agy` 换取令牌时也可能连不上 Google。
- **默认行为（无需配置）**：
  - 已设置 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量 → 直接使用你的设置；
  - 未设置，但系统代理已开启且代理端口可连通 → 启动时自动沿用系统代理；
  - 未使用代理 → 直连，不做任何改动。
- **排查**：
  1. 启动日志出现 `Using the Windows system proxy` 说明已自动沿用系统代理；
  2. 如果代理使用 **PAC 脚本** 或 **仅 SOCKS** 协议，无法自动识别，请手动指定 HTTP 代理后再启动：
     ```cmd
     set HTTPS_PROXY=http://127.0.0.1:7890
     set HTTP_PROXY=http://127.0.0.1:7890
     start.cmd
     ```
  3. 想强制直连（忽略系统代理），启动前设置 `set AGY_STUDIO_PROXY=off`；
  4. 登录前的网络预检误报时，可用 `set AGY_STUDIO_SKIP_NET_CHECK=1` 跳过。

---

## 📄 开源许可

本项目依据 MIT 许可协议开源。
更多架构设计细节可参阅 `docs/ARCHITECTURE.md`。
