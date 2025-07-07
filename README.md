# NEXAIDE README
![ChatGPT Image 2025年6月22日 10_12_03](https://github.com/user-attachments/assets/a3c2a06c-0c3f-4ce3-abd9-1e6eb8072798)

This is the README for your extension "nexaide". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

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

# NEXAIDE AI Chat 功能说明

## 功能概述

NEXAIDE 现在包含了一个类似于 Cursor 和 Trae 的 AI 聊天功能，位于 VSCode 的右侧边栏中。

## 主要特性

### 🤖 AI 聊天界面
- **侧边栏集成**: 在 VSCode 活动栏中点击机器人图标即可打开
- **实时对话**: 支持与 AI 助手进行实时对话
- **代码高亮**: 自动识别和高亮显示代码块
- **聊天历史**: 自动保存聊天记录，重启 VSCode 后仍可查看

### 💬 智能回复
- **编程语言支持**: 针对 JavaScript、Python 等语言提供专业建议
- **调试帮助**: 协助分析和解决代码错误
- **代码生成**: 根据描述生成代码示例
- **最佳实践**: 提供编程最佳实践建议

### 🎨 用户界面
- **VSCode 主题适配**: 自动适应 VSCode 的颜色主题
- **响应式设计**: 支持不同尺寸的侧边栏
- **模型选择**: 支持选择不同的 AI 模型（GPT-3.5、GPT-4、Claude 3）
- **快捷操作**: 支持 Enter 发送消息，Shift+Enter 换行

## 使用方法

### 1. 打开 AI 聊天
- 点击 VSCode 左侧活动栏的机器人图标
- 或使用命令面板 (`Ctrl+Shift+P`) 搜索 "Open AI Chat"

### 2. 开始对话
- 在底部输入框中输入您的问题
- 按 Enter 发送消息
- AI 会在几秒钟内回复

### 3. 清除聊天记录
- 点击聊天面板标题栏的清除按钮
- 或使用命令 "Clear Chat History"

## 示例对话

```
用户: 如何在 JavaScript 中创建一个函数？

AI: 我可以帮你创建 JavaScript 函数！这里是一个简单的例子：

```javascript
function greet(name) {
    return `Hello, ${name}!`;
}

console.log(greet("World"));
```

你想了解哪个具体的 JavaScript 主题？
```

## 当前功能状态

✅ **已实现**:
- 侧边栏 AI 聊天界面
- 基本的 AI 对话功能（模拟响应）
- 聊天历史保存
- 代码语法高亮
- 清除聊天记录
- VSCode 主题适配

🔄 **待实现**:
- 集成真实的 AI API（OpenAI、Claude 等）
- 代码上下文感知
- 文件内容分析
- 代码自动补全集成
- 更多自定义设置

## 开发说明

### 文件结构
```
src/
├── extension.ts          # 主扩展文件
├── chatView.html         # AI 聊天界面 HTML
└── ...
```

### 关键组件
- `AIChatViewProvider`: WebView 提供者，处理聊天界面
- `handleAIMessage()`: 处理用户消息并生成 AI 回复
- `generateMockAIResponse()`: 生成模拟 AI 响应（待替换为真实 API）

### 下一步开发
1. 集成真实的 AI API
2. 添加代码上下文分析
3. 实现更智能的代码建议
4. 添加用户设置和配置选项

## 测试方法

1. 按 `F5` 启动调试模式
2. 在新的 VSCode 窗口中点击侧边栏的机器人图标
3. 尝试发送不同类型的消息测试 AI 回复
4. 测试聊天记录保存和清除功能

---

**注意**: 当前版本使用模拟的 AI 响应。要获得真正的 AI 功能，需要集成实际的 AI API 服务。
