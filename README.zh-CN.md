
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="TnymaAI Logo" />
</p>

<h1 align="center">TnymaAI</h1>

<p align="center">
  <strong>AI 智能体的桌面客户端</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#为什么选择-tnyma-ai">为什么选择 TnymaAI</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/TnymaAI/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja-JP.md">日本語</a>
</p>

---

## 概述

**TnymaAI** 是连接强大 AI 智能体与普通用户之间的桥梁。基于内置运行时构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，TnymaAI 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

TnymaAI 预置了最佳实践的模型供应商配置，原生支持 Windows 平台以及多语言设置。当然，你也可以通过 **设置 → 高级 → 开发者模式** 来进行精细的高级配置。

---

## 截图预览

<p align="center">
  <img src="resources/screenshot/zh/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/cron.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/skills.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/channels.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/models.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/settings.png" style="width: 100%; height: auto;">
</p>

---

## 为什么选择 TnymaAI

构建 AI 智能体不应该需要精通命令行。TnymaAI 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面。**

| 痛点 | TnymaAI 解决方案 |
|------|----------------|
| 复杂的命令行配置 | 一键安装，配合引导式设置向导 |
| 手动编辑配置文件 | 可视化设置界面，实时校验 |
| 进程管理繁琐 | 自动管理网关生命周期 |
| 多 AI 供应商切换 | 统一的供应商配置面板 |
| 技能/插件安装复杂 | 内置技能市场与管理界面 |

### 内置运行时核心

TnymaAI 直接内置官方运行时核心。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验。

我们致力于与上游运行时项目保持严格同步，确保你始终可以使用官方发布的最新功能、稳定性改进和生态兼容性。

---

## 功能特性

### 🎯 零配置门槛
从安装到第一次 AI 对话，全程通过直观的图形界面完成。无需终端命令，无需 YAML 文件，无需到处寻找环境变量。

### 💬 智能聊天界面
通过现代化的聊天体验与 AI 智能体交互。支持多会话上下文、消息历史记录、Markdown 富文本渲染，以及在多 Agent 场景下通过主输入框中的 `@agent` 直接路由到目标智能体。
当你使用 `@agent` 选择其他智能体时，TnymaAI 会直接切换到该智能体自己的对话上下文，而不是经过默认智能体转发。各 Agent 工作区默认彼此分离，但更强的运行时隔离仍取决于运行时 sandbox 配置。

### 📡 多频道管理
同时配置和监控多个 AI 频道。每个频道独立运行，允许你为不同任务运行专门的智能体。
现在每个频道支持多个账号，并可在 Channels 页面直接完成账号绑定到 Agent 与默认账号切换。
TnymaAI 现在还内置了腾讯官方个人微信渠道插件，可直接在 Channels 页面通过内置二维码流程完成微信连接，也可以在设置向导里直接发起同样的扫码接入流程。
飞书频道现在同时支持两种接入方式：手动填写 App ID / App Secret，或直接在 Channels 页面扫码登录后自动创建机器人、开通权限、订阅事件、发布，并在成功后向创建者主动发送一条欢迎消息。QQ 机器人频道也支持保留手动填写 App ID / Client Secret，同时在同一页面通过扫码一键创建机器人、自动写回凭证，并在创建成功后主动发送欢迎消息。

### ⏰ 定时任务自动化
调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。

### 🧩 可扩展技能系统
通过预构建的技能扩展 AI 智能体的能力。在集成的技能面板中浏览、安装和管理技能——无需包管理器。
TnymaAI 还会内置预装完整的文档处理技能（`pdf`、`xlsx`、`docx`、`pptx`），在启动时自动部署到托管技能目录（默认 `~/.openclaw/skills`），并在首次安装时默认启用。额外预装技能（`find-skills`、`self-improving-agent`、`tavily-search`、`brave-web-search`）也会默认启用；若缺少必需的 API Key，TnymaAI 会在运行时给出配置错误提示。
Skills 页面可展示来自多个运行时来源的技能（托管目录、workspace、额外技能目录），并显示每个技能的实际路径，便于直接打开真实安装位置。

重点搜索技能所需环境变量：
- `BRAVE_SEARCH_API_KEY`：用于 `brave-web-search`
- `TAVILY_API_KEY`：用于 `tavily-search`（上游运行时也可能支持 OAuth）

### 🔐 安全的供应商集成
连接多个 AI 供应商（OpenAI、Anthropic 等），凭证安全存储在系统原生密钥链中。OpenAI 同时支持 API Key 与浏览器 OAuth（Codex 订阅）登录。
Provider 配置现在直接跟随上游 auth choice 目录，而不是安装器本地裁剪过的一小部分预设。因此，设置向导和 **设置 → AI Providers** 会尽量对齐原版运行时的 Provider 入口。
当 API Key 校验通过，或 OAuth 登录成功后，TnymaAI 会立即拉取该 Provider 的模型列表，并把同步到的模型清单保存到账号上，后续可以直接从已同步的模型列表里切换，而不是手动输入模型 ID。
如果你通过 **自定义（Custom）Provider** 对接 OpenAI-compatible 网关，可以在 **设置 → AI Providers → 编辑 Provider** 中配置自定义 `User-Agent`，以提高兼容性。

### 🌙 自适应主题
支持浅色模式、深色模式或跟随系统主题。TnymaAI 自动适应你的偏好设置。

### 🚀 开机启动控制
在 **设置 → 通用** 中，你可以开启 **开机自动启动**，让 TnymaAI 在系统登录后于后台自动启动。
如果 **自动启动网关** 保持开启，后台启动时也会自动恢复 TnymaAI Gateway，而不会重新弹出设置向导。
一旦初次配置完成，之后再次打开 TnymaAI 时会进入一个轻量的 Control UI 启动页，它会打开安装器内置的 TnymaAI Web 页面，而不再回到多步骤安装向导。

---

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：1GB 可用磁盘空间

### 安装方式

#### 预构建版本（推荐）

从 [Releases](https://github.com/ValueCell-ai/TnymaAI/releases) 页面下载适用于你平台的最新版本。

#### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/ValueCell-ai/TnymaAI.git
cd TnymaAI

# 初始化项目
pnpm run init

# 以开发模式启动
pnpm dev
```
### 首次启动

首次启动 TnymaAI 时，**设置向导** 将引导你完成以下步骤：

1. **语言与区域** – 配置你的首选语言和地区
2. **环境检查** – 校验内置 TnymaAI 运行时，并启动 Gateway
3. **AI 供应商** – 从 TnymaAI 上游的 Provider auth choices 中选择入口，完成 API Key 或 OAuth 校验
4. **模型选择** – 同步该 Provider 的模型列表，并保存默认模型；如果成功拉到模型列表，会默认选中第一个模型
5. **微信 / 飞书 / QQ 机器人** – 在模型步骤之后，可选配置微信、飞书或 QQ 机器人，支持扫码一键创建
6. **组件安装** – 安装默认本地技能并完成桌面端初始化

如果系统语言在支持列表中，向导会默认选中该语言；否则回退到英文。

> Moonshot（Kimi）说明：TnymaAI 默认保持开启 Kimi 的 web search。  
> 当配置 Moonshot 后，TnymaAI 也会将运行时配置中的 Kimi web search 同步到中国区端点（`https://api.moonshot.cn/v1`）。

### 代理设置

TnymaAI 内置了代理设置，适用于需要通过本地代理客户端访问外网的场景，包括 Electron 本身、TnymaAI Gateway，以及 Telegram 这类频道的联网请求。

打开 **设置 → 网关 → 代理**，配置以下内容：

- **代理服务器**：所有请求默认使用的代理
- **绕过规则**：需要直连的主机，使用分号、逗号或换行分隔
- 在 **开发者模式** 下，还可以单独覆盖：
  - **HTTP 代理**
  - **HTTPS 代理**
  - **ALL_PROXY / SOCKS**

本地代理的常见填写示例：

```text
代理服务器: http://127.0.0.1:7890
```
说明：

- 只填写 `host:port` 时，会按 HTTP 代理处理。
- 高级代理项留空时，会自动回退到“代理服务器”。
- 保存代理设置后，Electron 网络层会立即重新应用代理，并自动重启 Gateway。
- 如果启用了 Telegram，TnymaAI 还会把代理同步到运行时的 Telegram 频道配置中。
- 当 TnymaAI 代理处于关闭状态时，Gateway 的常规重启会保留已有的 Telegram 频道代理配置。
- 如果你要明确清空运行时中的 Telegram 代理，请在关闭代理后点一次“保存代理设置”。
- 在 **设置 → 高级 → 开发者** 中，可以直接运行 **运行时诊断**，执行 `openclaw doctor --json` 并在应用内查看诊断输出。
- 在 Windows 打包版本中，内置的 `openclaw` CLI/TUI 会通过随包分发的 `node.exe` 入口运行，以保证终端输入行为稳定。

---

## 系统架构

TnymaAI 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理：

```┌─────────────────────────────────────────────────────────────────┐
│                        TnymaAI 桌面应用                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron 主进程                                 │  │
│  │  • 窗口与应用生命周期管理                                      │  │
│  │  • 网关进程监控                                               │  │
│  │  • 系统集成（托盘、通知、密钥链）                                │  │
│  │  • 自动更新编排                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（权威控制面）                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React 渲染进程                                   │  │
│  │  • 现代组件化 UI（React 19）                                   │  │
│  │  • Zustand 状态管理                                           │  │
│  │  • 统一 host-api/api-client 调用                               │  │
│  │  • Markdown 富文本渲染                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 主进程统一传输策略
                               │（WS 优先，HTTP 次之，IPC 回退）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Host API 与主进程代理层                          │
│                                                                  │
│  • hostapi:fetch（主进程代理，规避开发/生产 CORS）                │
│  • gateway:httpProxy（渲染进程不直连 Gateway HTTP）               │
│  • 统一错误映射与重试/退避策略                                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WS / HTTP / IPC 回退
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TnymaAI 网关                                 │
│                                                                  │
│  • AI 智能体运行时与编排                                          │
│  • 消息频道管理                                                   │
│  • 技能/插件执行环境                                              │
│  • 供应商抽象层                                                   │
└─────────────────────────────────────────────────────────────────┘
```
### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：WS/HTTP 选择与 IPC 回退在主进程集中处理，提升稳定性
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：本地 HTTP 请求由主进程代理，避免渲染进程跨域问题

### 进程模型与 Gateway 排障

- TnymaAI 基于 Electron，**单个应用实例出现多个系统进程是正常现象**（main/renderer/zygote/utility）。
- 单实例保护同时使用 Electron 自带锁与本地进程文件锁回退机制，可在桌面会话总线异常时避免重复启动。
- 滚动升级期间若新旧版本混跑，单实例保护仍可能出现不对称行为。为保证稳定性，建议桌面客户端尽量统一升级到同一版本。
- 但 TnymaAI Gateway 监听应始终保持**单实例**：`127.0.0.1:18789` 只能有一个监听者。
- 可用以下命令确认监听进程：
  - macOS/Linux：`lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows（PowerShell）：`Get-NetTCPConnection -LocalPort 18789 -State Listen`
- 点击窗口关闭按钮（`X`）默认只是最小化到托盘，并不会完全退出应用。请在托盘菜单中选择 **Quit TnymaAI** 执行完整退出。

---

## 使用场景

### 🤖 个人 AI 助手
配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。

### 📊 自动化监控
设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件。结果将推送到你偏好的通知渠道。

### 💻 开发者效率工具
将 AI 融入你的开发工作流。使用智能体进行代码审查、生成文档或自动化重复性编码任务。

### 🔄 工作流自动化
将多个技能串联起来，创建复杂的自动化流水线。处理数据、转换内容、触发操作——全部通过可视化方式编排。

---

## 开发指南

### 前置要求

- **Node.js**：22+（推荐 LTS 版本）
- **包管理器**：pnpm 9+（推荐）或 npm

### 项目结构

```TnymaAI/
├── electron/                 # Electron 主进程
│   ├── api/                 # 主进程 API 路由与处理器
│   │   └── routes/          # RPC/HTTP 代理路由模块
│   ├── services/            # Provider、Secrets 与运行时服务
│   │   ├── providers/       # Provider/account 模型同步逻辑
│   │   └── secrets/         # 系统钥匙串与密钥存储
│   ├── shared/              # 共享 Provider schema/常量
│   │   └── providers/
│   ├── main/                # 应用入口、窗口、IPC 注册
│   ├── gateway/             # TnymaAI 网关进程管理
│   ├── preload/             # 安全 IPC 桥接
│   └── utils/               # 工具模块（存储、认证、路径）
├── src/                      # React 渲染进程
│   ├── lib/                 # 前端统一 API 与错误模型
│   ├── stores/              # Zustand 状态仓库（settings/chat/gateway）
│   ├── components/          # 可复用 UI 组件
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # 国际化资源
│   └── types/               # TypeScript 类型定义
├── tests/
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载 uv
pnpm dev                  # 以热重载模式启动（若缺失会自动准备预装技能包）

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run comms:replay     # 计算通信回放指标
pnpm run comms:baseline   # 刷新通信基线快照
pnpm run comms:compare    # 将回放指标与基线阈值对比

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm build                # 完整生产构建（含打包资源）
pnpm package              # 为当前平台打包（包含预装技能资源）
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 为 Windows 打包
pnpm package:linux        # 为 Linux 打包
pnpm run cleanup:installed:mac -- --yes  # 清理已安装的 macOS 应用数据、登录项和 CLI 残留
```

如果安装器打包时需要内嵌本地 `tnyma-ai` 的 web 栈，而你的源码仓库不在常见自动发现目录（`../tnyma-ai`、`~/ai/tnyma-ai`、`~/github/tnyma-ai`、`~/Desktop/tnyma-ai`）中，请显式设置 `TNYMA_AI_SOURCE_ROOT`。
打包脚本会优先执行源码仓库里的 `build:web`，如果没有这个脚本，则自动回退到 `build`。

### 本地 GitLab CI/CD

仓库现已包含面向 `tnyma-ai` + `tnyma-ai-installer` 的本地 GitLab CI/CD 骨架：

- GitLab Docker 部署：`ops/gitlab/docker-compose.yml`
- GitLab 启动说明：`ops/gitlab/README.md`
- 安装器流水线：`.gitlab-ci.yml`
- `tnyma-ai` 仓库起步模板：`ops/gitlab/templates/tnyma-ai.gitlab-ci.yml`

流水线默认以 npm 上的 `openclaw` 包作为运行时真源，并要求 `tnyma-ai` 以编译后的运行时产物形式打入安装包。
对于 tag 流水线，GitLab CI 还会自动发布一个 GitLab Release 页面，附带自动生成的变更记录，以及 macOS、Windows、Linux 安装包的长期下载链接。
tag 流水线现在还会校验 `TNYMA_AI_REF` 必须是不可变版本、验证 macOS 公证结果，并可选接入飞书构建/发布机器人通知。

### 通信回归检查

当 PR 涉及通信链路（Gateway 事件、Chat 收发流程、Channel 投递、传输回退）时，建议执行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI 中的 `comms-regression` 会校验必选场景与阈值。
### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 40+ |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |

---

## 参与贡献

我们欢迎社区的各种贡献！无论是修复 Bug、开发新功能、改进文档还是翻译——每一份贡献都让 TnymaAI 变得更好。

### 如何贡献

1. **Fork** 本仓库
2. **创建** 功能分支（`git checkout -b feature/amazing-feature`）
3. **提交** 清晰描述的变更
4. **推送** 到你的分支
5. **创建** Pull Request

### 贡献规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰

---

## 致谢

TnymaAI 构建于以下优秀的开源项目之上：

- [运行时上游项目](https://github.com/OpenClaw) – AI 智能体运行时
- [Electron](https://www.electronjs.org/) – 跨平台桌面框架
- [React](https://react.dev/) – UI 组件库
- [shadcn/ui](https://ui.shadcn.com/) – 精美设计的组件库
- [Zustand](https://github.com/pmndrs/zustand) – 轻量级状态管理

---

## 社区

加入我们的社区，与其他用户交流、获取帮助、分享你的使用体验。

| 企业微信 | 飞书群组 | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="企业微信二维码" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="飞书二维码" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord 二维码" /> |

### TnymaAI 合作伙伴计划 🚀

我们正在启动 TnymaAI 合作伙伴计划，寻找能够帮助我们将 TnymaAI 介绍给更多客户的合作伙伴，尤其是那些有定制化 AI 智能体或自动化需求的客户。

合作伙伴负责帮助我们连接潜在用户和项目，TnymaAI 团队则提供完整的技术支持、定制开发与集成服务。

如果你服务的客户对 AI 工具或自动化方案感兴趣，欢迎与我们合作。

欢迎私信我们，或发送邮件至 [public@valuecell.ai](mailto:public@valuecell.ai) 了解更多。

---

## Stars 历史

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/TnymaAI&type=Date" alt="Stars 历史图表" />
</p>

---

## 许可证

TnymaAI 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

---

<p align="center">
  <sub>由 ValueCell 团队用 ❤️ 打造</sub>
</p>
