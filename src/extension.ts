// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// AI Chat View Provider
class AIChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexaide.chatView';
	private _view?: vscode.WebviewView;
	constructor(private readonly _extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			async (data) => {
				switch (data.command) {
					case 'sendMessage':
						await this.handleAIMessage(data.message, data.model);
						break;
					case 'openSettings':
						this.openSettings();
						break;
					case 'attachFile':
						await this.attachFile();
						break;
					case 'clearChat':
						this.clearChat();
						break;
				}
			}
		);
	}

	private async handleAIMessage(message: string, model: string) {
		try {
			// Simulate AI response (replace with actual AI API call)
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			const aiResponse = this.generateMockAIResponse(message);
			
			if (this._view) {
				this._view.webview.postMessage({
					command: 'addMessage',
					content: aiResponse,
					type: 'assistant'
				});
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({
					command: 'addMessage',
					content: '❌ 获取AI响应失败，请重试。',
					type: 'system'
				});
			}
		}
	}

	private generateMockAIResponse(message: string): string {
		// Mock AI responses based on message content
		const lowerMessage = message.toLowerCase();
		
		if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('你好') || lowerMessage.includes('您好')) {
			return '👋 您好！我是 NEXAIDE AI 编程助手。我可以帮助您进行代码开发、调试和优化。有什么我可以为您做的吗？';
		}
		
		if (lowerMessage.includes('javascript') || lowerMessage.includes('js')) {
			return '🚀 我可以帮助您处理 JavaScript 相关问题！这里是一个简单的示例：\n\n```javascript\nfunction greet(name) {\n    return `你好, ${name}!`;\n}\n\nconsole.log(greet("世界"));\n```\n\n您想了解 JavaScript 的哪个具体方面呢？';
		}
		
		if (lowerMessage.includes('python')) {
			return '🐍 Python 是一门很棒的语言！这里是一个快速示例：\n\n```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))\n```\n\n您想了解 Python 的哪个概念呢？';
		}
		
		if (lowerMessage.includes('debug') || lowerMessage.includes('error') || lowerMessage.includes('调试') || lowerMessage.includes('错误')) {
			return '🔍 我可以帮助您调试代码！请分享：\n\n1. 您看到的错误信息\n2. 相关的代码片段\n3. 您期望发生的情况\n\n这将帮助我提供更有针对性的帮助。';
		}
		
		if (lowerMessage.includes('function') || lowerMessage.includes('method') || lowerMessage.includes('函数') || lowerMessage.includes('方法')) {
			return '⚡ 函数是编程的基础构建块！以下是一些最佳实践：\n\n• 使用描述性的名称\n• 保持函数小而专注\n• 处理边界情况\n• 添加适当的文档\n\n您有什么具体的函数相关问题吗？';
		}
		
		if (lowerMessage.includes('解释') || lowerMessage.includes('explain')) {
			return '📖 我很乐意为您解释代码！请粘贴您想要理解的代码片段，我会详细解释其功能和工作原理。';
		}
		
		if (lowerMessage.includes('优化') || lowerMessage.includes('optimize')) {
			return '⚡ 代码优化是提高性能和可读性的重要步骤！请分享您的代码，我会提供优化建议，包括：\n\n• 性能改进\n• 代码简化\n• 最佳实践应用\n• 可读性提升';
		}
		
		if (lowerMessage.includes('测试') || lowerMessage.includes('test')) {
			return '🧪 编写测试是确保代码质量的关键！我可以帮助您：\n\n• 生成单元测试\n• 设计测试用例\n• 选择测试框架\n• 测试最佳实践\n\n请分享您需要测试的代码！';
		}
		
		return `💭 我理解您询问的是："${message}"\n\n作为您的 AI 编程助手，我可以帮助您：\n\n• 🔧 代码生成和补全\n• 🐛 调试和错误修复\n• 📊 代码审查和优化\n• 📚 解释编程概念\n• ✨ 最佳实践和模式\n\n请提供更多具体细节，我将为您提供更精准的帮助！`;
	}

	public clearChat() {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'clearChat'
			});
		}
	}

	private openSettings() {
		// Open VS Code settings focused on NEXAIDE extension
		vscode.commands.executeCommand('workbench.action.openSettings', 'nexaide');
	}

	private async attachFile() {
		try {
			const fileUri = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: {
					'Code Files': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs'],
					'Text Files': ['txt', 'md', 'json', 'xml', 'yaml', 'yml'],
					'All Files': ['*']
				}
			});

			if (fileUri && fileUri[0]) {
				const filePath = fileUri[0].fsPath;
				const fileName = path.basename(filePath);
				const fileContent = fs.readFileSync(filePath, 'utf8');
				
				// Limit file size to prevent overwhelming the chat
				if (fileContent.length > 10000) {
					vscode.window.showWarningMessage('文件太大，请选择小于10KB的文件。');
					return;
				}

				// Send file content to chat
				if (this._view) {
					this._view.webview.postMessage({
						command: 'addMessage',
						content: `📎 已附加文件: ${fileName}\n\n\`\`\`\n${fileContent}\n\`\`\``,
						type: 'user'
					});
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage('附加文件失败: ' + error);
		}
	}

	public updateModel(model: string) {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'updateModel',
				model: model
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Read the HTML file
		const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'chatView.html');
		return fs.readFileSync(htmlPath, 'utf8');
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "nexaide" is now active!');

	// Create the AI Chat View Provider
	const aiChatProvider = new AIChatViewProvider(context.extensionUri);

	// Register the webview view provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			AIChatViewProvider.viewType,
			aiChatProvider
		)
	);

	// Register commands
	const helloWorldCommand = vscode.commands.registerCommand('nexaide.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from NEXAIDE!');
	});

	const openChatCommand = vscode.commands.registerCommand('nexaide.openChat', () => {
		vscode.commands.executeCommand('nexaide.chatView.focus');
	});

	const clearChatCommand = vscode.commands.registerCommand('nexaide.clearChat', () => {
		aiChatProvider.clearChat();
	});

	context.subscriptions.push(helloWorldCommand, openChatCommand, clearChatCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
