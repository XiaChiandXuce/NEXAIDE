// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { TraeAgentService, TraeAgentResponse } from './services/TraeAgentService';

// AI Chat View Provider
class AIChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexaide.chatView';
	private _view?: vscode.WebviewView;
	private traeAgent: TraeAgentService;
	private useAgentMode: boolean = false;
	private terminal: vscode.Terminal | undefined;
	
	constructor(private readonly _extensionUri: vscode.Uri) {
		this.traeAgent = new TraeAgentService(_extensionUri.fsPath);
	}

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

		// 主动发送 Trae-Agent 可用性状态到前端
		this.traeAgent.isTraeAgentAvailable().then((isAvailable) => {
		    try {
		        webviewView.webview.postMessage({
		            command: 'agentStatus',
		            available: isAvailable,
		            info: isAvailable ? '✅ Trae-Agent 已就绪' : '⚠️ Trae-Agent 未检测到，请检查安装和配置'
		        });
		    } catch (e) {
		        // 忽略发送异常
		    }
		});

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(
			async (data) => {
				switch (data.command) {
					case 'sendMessage':
						await this.handleAIMessage(data.message, data.model);
						break;
					case 'toggleAgentMode':
						await this.toggleAgentMode();
						break;
					case 'stopAgent':
						this.stopAgentExecution();
						break;
					case 'getAgentInfo':
						await this.sendAgentInfo();
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
					case 'newSession':
						this.createNewSession();
						break;
					case 'openHistory':
						this.openHistory();
						break;
					case 'openAIManage':
						this.openAIManage();
						break;
					case 'closePlugin':
						this.closePlugin();
						break;
					case 'runCommandInTerminal':
						this.runCommandInTerminal(String(data.commandText || ''), typeof data.workingDirectory === 'string' ? data.workingDirectory : undefined);
						break;
				}
			}
		);
	}

	private async handleAIMessage(message: string, model: string) {
		try {
			// 显示正在思考的状态
			if (this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: true });
			}

			let aiResponse: string | undefined;

			if (this.useAgentMode && this.traeAgent.isTraeAgentAvailableSync()) {
				// 使用 Trae-Agent 模式（暂未流式化）
				aiResponse = await this.handleAgentMessage(message);
			} else {
				// 使用 DashScope 兼容 OpenAI 的流式接口返回
				if (this._view) {
					this._view.webview.postMessage({ command: 'startAssistantMessage' });
				}
				console.log('[NEXAIDE][Stream] startAssistantMessage sent (normal mode)');
				await this.callQwenAPIStream(message, model);
			}

			// 非流式（Agent 模式）返回后追加消息并关闭打字状态
			if (aiResponse !== undefined && this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
				this._view.webview.postMessage({ command: 'addMessage', content: aiResponse, type: 'assistant' });
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
				this._view.webview.postMessage({ command: 'addMessage', content: `❌ 获取AI响应失败: ${error instanceof Error ? error.message : '未知错误'}，请重试。`, type: 'system' });
			}
		}
	}

	private async callQwenAPIStream(message: string, model: string = 'qwen-max'): Promise<void> {
		return new Promise((resolve, reject) => {
			const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '';
			if (!apiKey) {
				if (this._view) {
					this._view.webview.postMessage({
						command: 'addMessage',
						content: '⚠️ 未配置 DashScope API Key。请在系统环境变量 DASHSCOPE_API_KEY 或 OPENAI_API_KEY 中设置后重试。',
						type: 'system'
					});
					this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
				}
				return reject(new Error('Missing API key'));
			}

			const payload = {
				model,
				messages: [
					{ role: 'system', content: '你是NEXAIDE AI编程助手，专门帮助开发者进行代码开发、调试和优化。请用简洁、专业的方式回答问题，并在适当时提供代码示例。' },
					{ role: 'user', content: message }
				],
				stream: true,
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
					'Accept': 'text/event-stream',
					'Content-Length': Buffer.byteLength(postData)
				},
				timeout: 60000
			};

			const req = https.request(options, (res) => {
				if (res.statusCode && res.statusCode !== 200) {
					let errData = '';
					res.on('data', chunk => errData += chunk);
					res.on('end', () => {
						const msg = errData || `HTTP ${res.statusCode}`;
						console.error('[NEXAIDE][Stream] API error response:', msg);
						reject(new Error(`API请求失败: ${msg}`));
						if (this._view) {
							this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
							this._view.webview.postMessage({ command: 'addMessage', content: `❌ API错误: ${msg}`, type: 'system' });
						}
					});
					return;
				}

				let buffer = '';
				let started = false;

				res.on('data', (chunk) => {
					const str = chunk.toString('utf8');
					buffer += str;
					const parts = buffer.split('\n');
					buffer = parts.pop() || '';
					for (const line of parts) {
						const trimmed = line.trim();
						if (!trimmed) { continue; }
						if (trimmed.startsWith('data:')) {
							const dataStr = trimmed.substring(5).trim();
							if (dataStr === '[DONE]') {
								console.log('[NEXAIDE][Stream] Received [DONE]');
								// 完成
								if (this._view) {
									this._view.webview.postMessage({ command: 'finishAssistantMessage' });
								}
								return resolve();
							}
							try {
								const json = JSON.parse(dataStr);
								const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
								if (delta) {
									started = true;
									console.log(`[NEXAIDE][Stream] Append chunk, length=${delta.length}`);
									if (this._view) {
										this._view.webview.postMessage({ command: 'appendAssistantChunk', content: delta });
									}
								}
							} catch (e) {
								// 忽略解析错误，继续读取
							}
						}
					}
				});

				res.on('end', () => {
					console.log('[NEXAIDE][Stream] Response ended');
					// 若未显式收到 [DONE]，也结束
					if (this._view) {
						this._view.webview.postMessage({ command: 'finishAssistantMessage' });
					}
					resolve();
				});
			});

			req.on('error', (error) => {
				if (this._view) {
					this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
					this._view.webview.postMessage({ command: 'addMessage', content: `网络请求失败: ${error.message}`, type: 'system' });
				}
				reject(new Error(`网络请求失败: ${error.message}`));
			});

			req.on('timeout', () => {
				req.destroy();
				if (this._view) {
					this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
					this._view.webview.postMessage({ command: 'addMessage', content: '请求超时，请重试', type: 'system' });
				}
				reject(new Error('请求超时，请重试'));
			});

			req.write(postData);
			req.end();
		});
	}

	private async callQwenAPI(message: string, model: string = 'qwen-max'): Promise<string> {
		return new Promise((resolve, reject) => {
			const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '';
			if (!apiKey) {
				return reject(new Error('Missing API key'));
			}

			const payload = {
				model: model,
				messages: [
					{ role: 'system', content: '你是NEXAIDE AI编程助手，专门帮助开发者进行代码开发、调试和优化。请用简洁、专业的方式回答问题，并在适当时提供代码示例。' },
					{ role: 'user', content: message }
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
				res.on('data', (chunk) => { data += chunk; });
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

	public createNewSession() {
		// 清空当前聊天记录
		if (this._view) {
			this._view.webview.postMessage({
				command: 'clearChat'
			});
		}
		// 显示成功消息
		vscode.window.showInformationMessage('已创建新的对话会话');
	}

	private openHistory() {
		// TODO: 实现历史会话功能
		vscode.window.showInformationMessage('历史会话功能正在开发中...');
	}

	private openAIManage() {
		// TODO: 实现AI功能管理
		vscode.window.showInformationMessage('AI功能管理正在开发中...');
	}

	/**
	 * 处理 Agent 模式的消息
	 */
	private async handleAgentMessage(message: string): Promise<string> {
		try {
			// 显示 Agent 执行状态
			if (this._view) {
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'executing',
					progress: '🤖 Agent 正在执行...'
				});
			}

			// 更健壮的工作目录解析：活动编辑器所在工作区 -> 第一个工作区 -> 让用户选择
			let workingDirectory = vscode.window.activeTextEditor ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.fsPath : undefined;
			if (!workingDirectory) {
				workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			}
			if (!workingDirectory) {
				const picked = await vscode.window.showOpenDialog({
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
					openLabel: '选择工作目录'
				});
				workingDirectory = picked && picked.length > 0 ? picked[0].fsPath : undefined;
			}
			if (!workingDirectory) {
				if (this._view) {
					this._view.webview.postMessage({
						command: 'agentProgress',
						status: 'error'
					});
				}
				vscode.window.showWarningMessage('未检测到工作目录。请在 VS Code 中打开项目或选择一个文件夹后重试。');
				return '❌ **Agent 执行失败:**\n\n未检测到工作目录。请在 VS Code 中打开项目或选择一个文件夹后重试。';
			}

            const result: TraeAgentResponse = await this.traeAgent.executeAgent(message, {
                timeout: 120000, // 2分钟超时
                workingDirectory,
                onProgress: (data: string) => {
                    // 实时显示执行进度
                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'agentProgress',
                            status: 'executing',
                            progress: data
                        });
                    }
                }
            });

            // 显示执行模式与运行环境说明
            if (this._view) {
                const modeText = result.mode === 'mcp' ? 'MCP' : (result.mode === 'cli' ? 'CLI' : '未知');
                const info = `🛠 执行模式: ${modeText}\n` +
                    `📂 工作目录: \`${workingDirectory}\`\n\n` +
                    `- Agent 内部执行：在后台子进程中运行（不可见终端）\n` +
                    `- “在终端运行”按钮：在 VS Code 集成终端运行（遵循你的终端配置）`;
                this._view.webview.postMessage({
                    command: 'addMessage',
                    content: info,
                    type: 'system'
                });
            }

            // 隐藏执行状态
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'agentProgress',
                    status: 'completed'
                });
            }

			if (result.success) {
				// 如果有工具调用，显示工具调用信息
				if (result.toolCalls && result.toolCalls.length > 0) {
					if (this._view) {
						this._view.webview.postMessage({
							command: 'showToolCalls',
							toolCalls: result.toolCalls
						});
					}
				}
				return `🤖 **Agent 响应:**\n\n${result.content}`;
			} else {
				return `❌ **Agent 执行失败:**\n\n${result.error || '未知错误'}\n\n*已自动切换到普通模式，您可以继续对话。*`;
			}
		} catch (error) {
			// 隐藏执行状态
			if (this._view) {
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'error'
				});
			}
			return `❌ **Agent 执行异常:**\n\n${error instanceof Error ? error.message : '未知错误'}\n\n*已自动切换到普通模式，您可以继续对话。*`;
		}
	}

	/**
	 * 切换 Agent 模式
	 */
	private async toggleAgentMode(): Promise<void> {
		this.useAgentMode = !this.useAgentMode;
		
		// 等待初始化完成后检查可用性
		const isAvailable = await this.traeAgent.isTraeAgentAvailable();
		
		if (this._view) {
			this._view.webview.postMessage({
				command: 'agentModeToggled',
				enabled: this.useAgentMode,
				available: isAvailable
			});
		}

		const modeText = this.useAgentMode ? 'Agent 模式' : '普通聊天模式';
		const statusIcon = this.useAgentMode ? '🤖' : '💬';
		
		if (this.useAgentMode && !isAvailable) {
			vscode.window.showWarningMessage('Trae-Agent 不可用，请检查安装配置。已切换到普通模式。');
			this.useAgentMode = false;
			return;
		}

		vscode.window.showInformationMessage(`${statusIcon} 已切换到${modeText}`);
		
		// 在聊天中显示模式切换消息
		if (this._view) {
			this._view.webview.postMessage({
				command: 'addMessage',
				content: `${statusIcon} **模式切换:** 已切换到 ${modeText}`,
				type: 'system'
			});
		}
	}

	/**
	 * 停止 Agent 执行
	 */
	private stopAgentExecution(): void {
		this.traeAgent.stopExecution();
		
		if (this._view) {
			this._view.webview.postMessage({
				command: 'showAgentStatus',
				status: 'stopped'
			});
			this._view.webview.postMessage({
				command: 'addMessage',
				content: '⏹️ **Agent 执行已停止**',
				type: 'system'
			});
		}
		
		vscode.window.showInformationMessage('Agent 执行已停止');
	}

	/**
	 * 发送 Agent 信息
	 */
	private async sendAgentInfo(): Promise<void> {
		try {
			const agentInfo = await this.traeAgent.getAgentInfo();
			const isAvailable = await this.traeAgent.isTraeAgentAvailable();
			const agentPath = this.traeAgent.getTraeAgentPath();
			
			const infoMessage = `🤖 **Trae-Agent 信息:**\n\n` +
				`**状态:** ${isAvailable ? '✅ 可用' : '❌ 不可用'}\n` +
				`**路径:** \`${agentPath}\`\n` +
				`**当前模式:** ${this.useAgentMode ? '🤖 Agent 模式' : '💬 普通模式'}\n\n` +
				`**配置信息:**\n\`\`\`\n${agentInfo}\n\`\`\``;
			
			if (this._view) {
				this._view.webview.postMessage({
					command: 'addMessage',
					content: infoMessage,
					type: 'system'
				});
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({
					command: 'addMessage',
					content: `❌ 获取 Agent 信息失败: ${error instanceof Error ? error.message : '未知错误'}`,
					type: 'system'
				});
			}
		}
	}

	private closePlugin() {
		// 隐藏侧边栏
		vscode.commands.executeCommand('workbench.action.closeSidebar');
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Read the HTML file
		const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'chatView.html');
		let html = fs.readFileSync(htmlPath, 'utf8');
		
		// Get the logo image URI
		const logoPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'assets', 'nexaide-logo.svg');
		const logoUri = webview.asWebviewUri(logoPath);
		
		// Replace the placeholder with the actual logo URI
		html = html.replace('{{LOGO_URI}}', logoUri.toString());
		
		return html;
	}

	private runCommandInTerminal(command: string, workingDirectory?: string): void {
		try {
			if (!command || command.trim().length === 0) {
				vscode.window.showWarningMessage('无效的命令，无法在终端执行。');
				return;
			}
			// 选择 Shell（参考 VS Code terminal.integrated.defaultProfile.windows）
			const integratedConfig = vscode.workspace.getConfiguration('terminal.integrated');
			const defaultProfile = (integratedConfig.get<string>('defaultProfile.windows') || '').toLowerCase();
			let shellType: 'powershell' | 'cmd' | 'bash' = 'powershell';
			let shellPath: string = 'powershell.exe';
			if (defaultProfile.includes('cmd') || defaultProfile.includes('command prompt')) {
				shellType = 'cmd';
				shellPath = process.env.ComSpec || 'C\\\\Windows\\\\System32\\\\cmd.exe';
			} else if (defaultProfile.includes('bash')) {
				shellType = 'bash';
				shellPath = 'C\\\\Program Files\\\\Git\\\\bin\\\\bash.exe';
			} else {
				shellType = 'powershell';
				shellPath = 'powershell.exe';
			}
			// 复用或创建终端
			if (!this.terminal) {
				this.terminal = vscode.window.createTerminal({ name: 'NEXAIDE Terminal', shellPath });
			}
			this.terminal.show(true);
			// 轻风险提示（不强制确认，参考 Trae）
			const normalizedCmd = command.toLowerCase();
			if (/(rm\s+-rf|rmdir\s+|del\s+|format\s+|mkfs|shutdown|reboot|poweroff|dd\s+|diskpart|bcdedit|reg\s+delete|sc\s+delete|net\s+user\s+.*\/delete)/.test(normalizedCmd)) {
				vscode.window.showWarningMessage('⚠️ 检测到可能高风险命令：请确认工作目录与命令是否正确。');
			}
			// Windows UTF-8 保护 / Shell 适配
			if (shellType === 'powershell') {
				this.terminal.sendText("$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'", true);
			} else if (shellType === 'cmd') {
				this.terminal.sendText('set PYTHONIOENCODING=utf-8 & set PYTHONUTF8=1', true);
			} else { // bash
				this.terminal.sendText('export PYTHONIOENCODING=utf-8; export PYTHONUTF8=1', true);
			}
			// 工作目录切换
			if (workingDirectory && workingDirectory.trim().length > 0) {
				const wd = workingDirectory.replace(/"/g, '\\"');
				if (shellType === 'powershell') {
					this.terminal.sendText(`Set-Location -Path "${wd}"`, true);
				} else if (shellType === 'cmd') {
					this.terminal.sendText(`cd /d "${wd}"`, true);
				} else {
					this.terminal.sendText(`cd "${wd}"`, true);
				}
			}
			// 发送命令
			this.terminal.sendText(command, true);
		} catch (e) {
			vscode.window.showErrorMessage(`在终端运行命令失败: ${e instanceof Error ? e.message : String(e)}`);
		}
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

// runCommandInTerminal 已移入 AIChatViewProvider 类内，避免 this 未定义导致的编译错误。
