# NEXAIDE Plugin - AI编程助手插件

**NEXAIDE Plugin** 是一个现代化的 VS Code 扩展，为开发者提供 AI 驱动的编程辅助能力。基于先进的大语言模型，NEXAIDE 能够理解代码上下文、提供智能建议，并协助完成从解释到生成、调试与重构的各类任务。

![NEXAIDE Plugin](https://img.shields.io/badge/NEXAIDE-AI%20Assistant-blue?style=for-the-badge&logo=visualstudiocode)
![Version](https://img.shields.io/badge/version-0.1.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-orange?style=for-the-badge)

---

## ✨ 核心能力概览

### 🤖 AI 聊天助手
- 现代化界面与流畅动画，支持打字指示器与状态提示
- 基于通义千问模型的智能对话与代码理解
- 识别并高亮代码块，支持多语言代码分析
- 完整消息历史，带时间戳展示

### 🔧 代码辅助
- 一键解释、优化、调试、生成测试
- 支持文件拖拽/选择附加到会话
- 自动格式化代码块与生成建议
- 错误修复与重构建议

### 🧠 项目上下文与 Agent
- 深度集成 Trae-Agent，支持复杂软件工程任务执行
- 严格的“项目工作目录”机制，确保文件写入落地到正确位置
- 在无法确定工作目录时自动回退为普通聊天模式，保证可用性

---

## 🚀 快速开始

### 环境要求
- VS Code ≥ 1.101.2
- Node.js ≥ 16（开发时需要）
- Python ≥ 3.12（AI Agent 后端需要）

### 安装与编译

```bash
# 克隆项目
git clone <repository-url>
cd NEXAIDE-Plugin/nexaide

# 安装依赖
npm install

# 编译生成 dist/extension.js
npm run compile
```

### 启动扩展（开发模式）
- 在终端执行：

```bash
code --extensionDevelopmentPath "D:\TYHProjectLibrary\AICcompiler\NEXAIDE\NEXAIDE-Plugin\nexaide"
```

- 或者在 VS Code 按 F5 启动扩展开发主机。

---

## 重要概念：项目工作目录（Working Directory）

Agent 相关能力依赖“项目工作目录”，用于确定文件生成/修改的落地路径。扩展会按以下优先级解析工作目录：

1) 当前活动编辑器所属的工作区根目录（如有活动文件）
2) 当存在多个工作区时，选择第一个工作区根目录
3) 当没有打开任何工作区时，弹出系统文件夹选择对话框，请手动选择项目根目录
4) 若用户取消选择或仍无法确定，则不进入 Agent 模式，自动回退为普通聊天

TraeAgentService 在执行 Agent 任务时需要显式传入 `workingDirectory`。缺失时会返回错误并提示：

> Project working directory not detected. Please open the project root directory or select a working directory in the interface before executing the Agent. Automatically switched to normal mode, you can continue the conversation.

### 建议的使用姿势
- 推荐先“打开项目根目录”为工作区，再在侧边栏打开 NEXAIDE 面板并开始对话
- 若希望在无工作区下使用 Agent，请在弹出的文件夹选择框中选择目标目录
- 之后的文件创建/修改会在该工作目录下进行（例如生成 `tetris.py` 等）

---

## 使用指南

1. 打开侧边栏的 NEXAIDE 图标以进入聊天面板
2. 在输入框中提问或描述任务（可附加代码/文件）
3. 使用快捷操作：解释、优化、调试、生成测试
4. 查看会话历史、管理设置与清空对话等
5. 需要执行涉及代码生成/修改的任务时，确保已选择或打开正确的工作目录

### 界面与交互
- Enter 发送消息，Shift+Enter 换行
- 渐变头部与状态提示、平滑的消息动画、代码块高亮
- 响应式布局，支持不同侧边栏宽度

---

## 🔌 与 Trae-Agent 的集成

- 通过 TraeAgentService 承载 Agent 任务执行，要求显式的 `workingDirectory`
- 支持 CLI 回退机制并向 Agent 传递 `--working-dir` 参数
- 在工作目录不确定时提示并回退为普通聊天，避免误写到非预期路径

---

## 🛠️ 技术架构

```
NEXAIDE Plugin
├── Frontend (TypeScript)
│   ├── Extension Host（命令与消息处理）
│   ├── Webview UI（聊天与操作面板）
│   └── Command Handlers（快捷操作）
├── Services
│   └── Trae-Agent Bridge（TraeAgentService）
└── Integration
    ├── VS Code API
    └── File System Watcher
```

---

## ⚙️ 配置选项

- 通义千问 API 集成（示例：qwen 系列模型）
- 模型选择与智能参数（温度、最大 tokens 等）
- 超时与错误处理（网络/API 错误）

> 注意：请勿在代码或设置中提交任何密钥或敏感信息。

---

## 🧪 典型场景与示例

- 解释项目中的某个函数/类，并给出重构建议
- 在选定的工作目录下生成新文件（如示例脚本/测试用例）
- 根据自然语言描述创建初始代码骨架并落地到项目根目录

---

## 🐛 常见问题与排查

- 提示“未检测到项目工作目录”怎么办？
  - 打开项目根目录作为工作区，或在弹窗中手动选择文件夹
  - 若刚更新代码，请执行 `npm run compile` 并在扩展开发主机中“重新加载窗口”（Ctrl+R）
  - 确认 Node/Python 版本满足要求，依赖安装完成（`npm install`）

- 文件没有生成到预期位置？
  - 检查当前活动编辑器所属的工作区是否为期望的目录
  - 在多工作区场景下，默认使用第一个工作区根目录；可通过切换活动文件来影响解析

---

## 📝 更新日志

### 0.1.0
- 现代化聊天 UI 与代码高亮
- 快速操作按钮：解释 / 优化 / 调试 / 测试
- 文件附加与设置面板、清空与新建会话、历史会话（开发中）
- 与 Trae-Agent 的桥接与工作目录校验机制
- 在无法确定工作目录时自动回退普通模式并提示

---

## 🤝 贡献

欢迎贡献代码与建议！请先阅读项目的贡献与代码规范（CONTRIBUTING / DEVELOPMENT 指南）。

## 📄 许可证

本项目采用 MIT 许可证，详见 LICENSE。

---

让 AI 成为你的编程伙伴，显著提升开发效率！🚀
