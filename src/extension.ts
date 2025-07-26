// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

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
			// 显示正在思考的状态
			if (this._view) {
				this._view.webview.postMessage({
					command: 'showTyping',
					isTyping: true
				});
			}

			const aiResponse = await this.callQwenAPI(message, model);
			
			if (this._view) {
				this._view.webview.postMessage({
					command: 'showTyping',
					isTyping: false
				});
				this._view.webview.postMessage({
					command: 'addMessage',
					content: aiResponse,
					type: 'assistant'
				});
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({
					command: 'showTyping',
					isTyping: false
				});
				this._view.webview.postMessage({
					command: 'addMessage',
					content: `❌ 获取AI响应失败: ${error instanceof Error ? error.message : '未知错误'}，请重试。`,
					type: 'system'
				});
			}
		}
	}

	private async callQwenAPI(message: string, model: string = 'qwen-max'): Promise<string> {
		return new Promise((resolve, reject) => {
			const apiKey = 'sk-32800d6692f346d4a17b6d8116964b53';
			const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
			
			const payload = {
				model: model,
				messages: [
					{
						role: 'system',
						content: '你是NEXAIDE AI编程助手，专门帮助开发者进行代码开发、调试和优化。请用简洁、专业的方式回答问题，并在适当时提供代码示例。'
					},
					{
						role: 'user',
						content: message
					}
				],
				temperature: 1,
				max_tokens: 8192
			};

			const postData = JSON.stringify(payload);
			
			const options = {
				hostname: 'dashscope.aliyuncs.com',
				port: 443,
				path: '/compatible-mode/v1/chat/completions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData)
				},
				timeout: 60000
			};

			const req = https.request(options, (res) => {
				let data = '';
				
				res.on('data', (chunk) => {
					data += chunk;
				});
				
				res.on('end', () => {
					try {
						const result = JSON.parse(data);
						if (result.choices && result.choices[0] && result.choices[0].message) {
							resolve(result.choices[0].message.content);
						} else if (result.error) {
							reject(new Error(`API错误: ${result.error.message || '未知错误'}`));
						} else {
							reject(new Error('API响应格式错误'));
						}
					} catch (error) {
						reject(new Error(`解析响应失败: ${error instanceof Error ? error.message : '未知错误'}`));
					}
				});
			});

			req.on('error', (error) => {
				reject(new Error(`网络请求失败: ${error.message}`));
			});

			req.on('timeout', () => {
				req.destroy();
				reject(new Error('请求超时，请重试'));
			});

			req.write(postData);
			req.end();
		});
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
