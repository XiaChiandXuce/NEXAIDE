# NEXAIDE Plugin - AI编程助手插件

**NEXAIDE Plugin** 是一个现代化的VSCode扩展，为开发者提供AI驱动的编程辅助功能。基于先进的大语言模型，NEXAIDE能够理解代码上下文，提供智能建议，并协助解决编程问题。插件采用现代化UI设计，提供流畅的用户体验。

![NEXAIDE Plugin](https://img.shields.io/badge/NEXAIDE-AI%20Assistant-blue?style=for-the-badge&logo=visualstudiocode)
![Version](https://img.shields.io/badge/version-0.1.0-green?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-orange?style=for-the-badge)

## ✨ 核心功能

### 🤖 AI聊天助手
- **现代化界面**: 美观的渐变色设计，流畅的动画效果
- **智能对话**: 集成通义千问API，提供专业的编程助手服务
- **实时响应**: 支持打字指示器，提供即时反馈
- **代码理解**: AI能够分析当前代码文件和项目结构
- **多语言支持**: 支持主流编程语言的代码分析和建议
- **消息历史**: 完整的对话历史记录，支持时间戳显示

### 🔧 代码辅助功能
- **快速操作**: 一键解释代码、优化代码、调试代码、生成测试
- **文件附加**: 支持拖拽或选择文件附加到对话中
- **代码格式化**: 自动识别和格式化代码块
- **智能补全**: AI驱动的代码补全建议
- **错误修复**: 自动检测并建议修复代码错误
- **代码重构**: 智能代码重构和优化建议

### 🎯 开发者体验
- **侧边栏集成**: 专用的AI助手侧边栏面板，现代化UI设计
- **快捷键支持**: Enter发送消息，Shift+Enter换行
- **响应式设计**: 自适应界面布局，支持不同屏幕尺寸
- **设置面板**: 便捷的设置访问，支持模型选择
- **会话管理**: 新建会话、历史会话、AI功能管理等完整功能
- **窗口控制**: 支持关闭插件窗口等界面操作
- **状态管理**: 智能的界面状态管理和自动滚动

## 🚀 快速开始

### 安装要求
- VSCode 1.101.2 或更高版本
- Node.js 16+ (用于开发)
- Python 3.12+ (用于AI Agent后端)

### 开发环境设置

```bash
# 1. 克隆项目
git clone <repository-url>
cd NEXAIDE-Plugin/nexaide

# 2. 安装依赖
npm install

# 3. 编译插件
npm run compile

# 4. 在VSCode中按F5启动调试
```

### 使用方法

1. **打开AI助手**: 点击侧边栏的NEXAIDE AI图标
2. **开始对话**: 在聊天框中输入问题或请求
3. **快速操作**: 使用快速操作按钮（解释、优化、调试、测试）
4. **文件附加**: 点击📎按钮附加文件到对话中
5. **会话管理**: 
   - 点击➕按钮新建会话
   - 点击📋按钮查看历史会话
   - 点击🔧按钮管理AI功能
6. **窗口控制**: 点击✖️按钮关闭插件窗口
7. **获取建议**: AI会基于当前代码上下文提供建议

### 🎨 界面特色

- **现代化设计**: 采用渐变色头部设计，视觉效果优雅
- **流畅动画**: 消息发送和接收带有平滑的动画效果
- **代码高亮**: 自动识别代码块并进行语法高亮
- **响应式布局**: 适配不同尺寸的侧边栏宽度
- **状态指示**: 清晰的加载状态和错误提示

### 💡 使用技巧

- 使用 `Enter` 键快速发送消息
- 使用 `Shift + Enter` 在消息中换行
- 尝试发送包含"JavaScript"、"Python"、"调试"等关键词获得专业回复
- 附加代码文件可以获得更精准的分析建议

## 📸 功能演示

### 主界面
```
┌─────────────────────────────────────┐
│ 🤖 NEXAIDE AI    ➕📋🔧🗑️⚙️✖️│
├─────────────────────────────────────┤
│                                     │
│ 💬 AI: 你好！我是NEXAIDE AI助手...   │
│                                     │
│ 👤 用户: 解释这段JavaScript代码      │
│                                     │
│ 💬 AI: 这段代码实现了...            │
│                                     │
├─────────────────────────────────────┤
│ [💡解释] [⚡优化] [🐛调试] [🧪测试]    │
├─────────────────────────────────────┤
│ 输入消息... 📎              [发送] │
└─────────────────────────────────────┘
```

### 功能图标说明
- **➕ 新建会话**: 创建新的对话会话，清空当前聊天记录
- **📋 历史会话**: 查看和管理历史对话记录（开发中）
- **🔧 AI功能管理**: 管理AI相关功能和设置（开发中）
- **🗑️ 清空对话**: 清空当前聊天历史
- **⚙️ 设置**: 打开插件设置面板
- **✖️ 关闭窗口**: 关闭插件侧边栏窗口

### 快速操作
- **💡 解释代码**: 一键获取代码解释和分析
- **⚡ 优化代码**: 获得代码优化建议
- **🐛 调试代码**: 帮助定位和修复问题
- **🧪 生成测试**: 自动生成测试用例

## ⚙️ 配置选项

插件已集成通义千问API，支持以下配置：

* **API集成**: 使用阿里云通义千问API (qwen-max-2025-01-25)
* **模型选择**: 支持多种通义千问模型
* **智能参数**: 温度值1.0，最大令牌8192
* **错误处理**: 完善的网络错误和API错误处理
* **超时设置**: 60秒请求超时，确保稳定性

## 🔌 与Trae-Agent集成

NEXAIDE Plugin与Trae-Agent深度集成，提供强大的AI编程能力：

- **本地Agent服务**: 启动本地Trae-Agent服务
- **工具链集成**: 使用Trae-Agent的丰富工具生态
- **任务执行**: 执行复杂的软件工程任务
- **代码生成**: 基于自然语言描述生成代码

## 🛠️ 技术架构

```
NEXAIDE Plugin
├── Frontend (TypeScript)
│   ├── Extension Host
│   ├── Webview UI
│   └── Command Handlers
├── Communication Layer
│   ├── WebSocket Client
│   ├── HTTP API Client
│   └── Message Queue
└── Integration
    ├── Trae-Agent Bridge
    ├── VSCode API
    └── File System Watcher
```

## 📋 开发路线图

### v0.1.0 - 基础功能 ✅
- [x] 基础插件框架
- [x] 现代化AI聊天界面
- [x] 完整消息处理系统
- [x] 快速操作按钮
- [x] 文件附加功能
- [x] 设置面板集成
- [x] 响应式UI设计
- [x] 代码语法高亮
- [x] 动画效果和状态管理

### v0.2.0 - AI集成 🔄
- [ ] Trae-Agent通信桥梁
- [ ] 代码上下文分析
- [ ] 智能建议系统

### v0.3.0 - 功能增强 ⏳
- [ ] 代码补全集成
- [ ] 错误检测和修复
- [ ] 重构建议

### v1.0.0 - 完整版本 ⏳
- [ ] 完整AI功能套件
- [ ] 性能优化
- [ ] 用户体验优化

## 🐛 已知问题

- AI响应时间可能较长，正在优化中
- 某些复杂代码结构的分析准确性有待提升
- 大型项目的上下文分析性能需要优化

## 📝 更新日志

### 0.1.0 (当前版本)
- 🎨 现代化UI界面设计
- 💬 完整的AI聊天功能
- 🤖 **通义千问API集成** - 真实AI对话能力
- ⚡ 快速操作按钮（解释、优化、调试、测试）
- 📎 文件附加功能
- ⚙️ 设置面板集成
- 🗑️ 清空聊天功能
- ➕ **新建会话功能** - 一键创建新的对话会话
- 📋 **历史会话管理** - 历史对话记录功能（开发中）
- 🔧 **AI功能管理** - AI相关功能设置（开发中）
- ✖️ **窗口控制** - 关闭插件窗口功能
- 🎯 响应式设计和动画效果
- ⌨️ 键盘快捷键支持
- 🔍 代码语法高亮
- 📱 自适应界面布局
- ⏳ **打字指示器** - 显示AI思考状态
- ⚠️ **错误处理** - 完善的API错误提示

## 🤝 贡献指南

欢迎贡献代码和建议！请查看 [CONTRIBUTING.md](../../CONTRIBUTING.md) 了解详细信息。

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](../../LICENSE) 文件了解详情。

---

**让AI成为你的编程伙伴，提升开发效率！** 🚀

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
