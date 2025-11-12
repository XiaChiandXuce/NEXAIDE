// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { TraeAgentService, TraeAgentResponse } from './services/TraeAgentService';
import { CodexAgentService, CodexExecApprovalRequest, CodexApprovalDecision } from './services/CodexAgentService';

type AgentTaskStatus = 'idle' | 'running' | 'completed' | 'failed';
type AgentStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'rejected';

interface AgentStep {
	id: string;
	title: string;
	tool?: string;
	command?: string;
	cwd?: string;
	status: AgentStepStatus;
	output?: string;
	error?: string;
	createdAt: number;
	metadata?: {
		approvalSource?: 'codex' | 'trae';
		approvalRequestId?: number | string;
	};
}

interface AgentTask {
	id: string;
	title: string;
	status: AgentTaskStatus;
	steps: AgentStep[];
	createdAt: number;
}

// AI Chat View Provider
class AIChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexaide.chatView';
	private _view?: vscode.WebviewView;
	private traeAgent: TraeAgentService;
	private codexAgent?: CodexAgentService;
	private agentBackend: 'trae' | 'codex' = 'trae';
	private preferredAgentBackend: 'trae' | 'codex' = 'codex';
	private codexBinaryPath?: string;
	private traeAgentPathOverride?: string;
	private configurationListener?: vscode.Disposable;
	private codexPendingApprovalId?: number | string;
	private stepByApprovalId = new Map<number | string, string>();
	private useAgentMode: boolean = false;
	private useSessionMode: boolean = true;
	private terminal: vscode.Terminal | undefined;
	private _pendingAssistantMessage?: string;
	private _pendingToolCalls?: any[];
	private agentInitializationPromise?: Promise<void>;
	private currentTask?: AgentTask;
	private taskStepSeq: number = 0;
	
	constructor(private readonly _extensionUri: vscode.Uri) {
		this.applyConfigurationDefaults();
		this.traeAgent = new TraeAgentService(_extensionUri.fsPath);
		this.agentInitializationPromise = this.initializeAgentBackend();
		this.configurationListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
			if (
				event.affectsConfiguration('nexaide.agentBackend') ||
				event.affectsConfiguration('nexaide.codex.binaryPath') ||
				event.affectsConfiguration('nexaide.traeAgent.path')
			) {
				await this.reloadConfiguration();
			}
		});
	}

	private applyConfigurationDefaults(): void {
		const config = vscode.workspace.getConfiguration('nexaide');
		this.updatePreferencesFromConfiguration(config, true);
	}

	private async reloadConfiguration(): Promise<void> {
		const config = vscode.workspace.getConfiguration('nexaide');
		await this.updatePreferencesFromConfiguration(config, false);
	}

	private ensureAgentTask(message: string): void {
		if (!this.useAgentMode) {
			return;
		}
		if (this.currentTask && this.currentTask.status === 'running') {
			return;
		}
		const title = message.length > 40 ? `${message.slice(0, 40)}...` : message;
		this.currentTask = {
			id: `task-${Date.now()}`,
			title: title || 'Agent Task',
			status: 'running',
			steps: [],
			createdAt: Date.now()
		};
		this.taskStepSeq = 0;
		this.stepByApprovalId.clear();
		this._view?.webview.postMessage({
			command: 'taskInit',
			task: this.currentTask
		});
	}

	private createTaskStep(step: Omit<AgentStep, 'id' | 'createdAt'>): AgentStep | undefined {
		if (!this.currentTask) {
			return undefined;
		}
		const fullStep: AgentStep = {
			...step,
			id: `${this.currentTask.id}-step-${++this.taskStepSeq}`,
			createdAt: Date.now()
		};
		this.currentTask.steps.push(fullStep);
		this._view?.webview.postMessage({
			command: 'taskStepUpdate',
			step: fullStep
		});
		return fullStep;
	}

	private updateTaskStep(stepId: string, patch: Partial<AgentStep>): void {
		if (!this.currentTask) {
			return;
		}
		const step = this.currentTask.steps.find((s) => s.id === stepId);
		if (!step) {
			return;
		}
		Object.assign(step, patch);
		this._view?.webview.postMessage({
			command: 'taskStepUpdate',
			step
		});
	}

	private getStepByApprovalRequest(requestId?: number | string): AgentStep | undefined {
		if (typeof requestId === 'undefined' || !this.currentTask) {
			return undefined;
		}
		const stepId = this.stepByApprovalId.get(requestId);
		if (!stepId) {
			return undefined;
		}
		return this.currentTask.steps.find((s) => s.id === stepId);
	}

	private markCurrentTaskCompleted(status: AgentTaskStatus = 'completed'): void {
		if (!this.currentTask) {
			return;
		}
		this.currentTask.status = status;
		this._view?.webview.postMessage({
			command: 'taskComplete',
			task: this.currentTask
		});
	}

	private async updatePreferencesFromConfiguration(config: vscode.WorkspaceConfiguration, initial: boolean): Promise<void> {
		const newBackend = config.get<string>('agentBackend', 'codex') === 'trae' ? 'trae' : 'codex';
		const newCodexPath = (config.get<string>('codex.binaryPath') || '').trim() || undefined;
		const newTraePath = (config.get<string>('traeAgent.path') || '').trim() || undefined;

		const backendChanged = !initial && newBackend !== this.preferredAgentBackend;
		const codexPathChanged = !initial && newCodexPath !== this.codexBinaryPath;
		const traePathChanged = !initial && newTraePath !== this.traeAgentPathOverride;

		this.preferredAgentBackend = newBackend;
		this.agentBackend = newBackend;
		this.codexBinaryPath = newCodexPath;
		this.traeAgentPathOverride = newTraePath;

		if (this.codexBinaryPath) {
			process.env.NEXAIDE_CODEX_PATH = this.codexBinaryPath;
		} else {
			delete process.env.NEXAIDE_CODEX_PATH;
		}

		if (this.traeAgentPathOverride) {
			process.env.NEXAIDE_TRAE_AGENT_PATH = this.traeAgentPathOverride;
		} else {
			delete process.env.NEXAIDE_TRAE_AGENT_PATH;
		}

		if (!initial && traePathChanged) {
			this.traeAgent.stopExecution();
			this.traeAgent = new TraeAgentService(this._extensionUri.fsPath);
		}

		if (!initial && (codexPathChanged || backendChanged)) {
			await this.initializeAgentBackend(true);
		}

		if (!initial) {
			await this.sendAgentStatus();
		}
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

		this.sendAgentStatus();

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
					case 'getAgentStatus': {
						await this.sendAgentStatus();
						break;
					}
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
						await this.createNewSession();
						break;
					case 'toggleExecMode':
						this.useSessionMode = !!data.sessionEnabled;
						this._view?.webview.postMessage({
							command: 'agentExecModeToggled',
							sessionEnabled: this.useSessionMode
						});
						this._view?.webview.postMessage({
							command: 'addMessage',
							content: this.useSessionMode ? '🌀 已切换到 会话模式' : '⚡ 已切换到 一次性模式',
							type: 'system'
						});
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
					case 'toolCallsCompleted':
						if (this._view && this._pendingAssistantMessage) {
							this._view.webview.postMessage({
								command: 'addMessage',
								content: this._pendingAssistantMessage,
								type: 'assistant'
							});
						}
						this._pendingAssistantMessage = undefined;
						this._pendingToolCalls = undefined;
						this.codexPendingApprovalId = undefined;
						break;
					case 'setAgentBackend':
						await this.updateAgentBackendPreference(data.backend === 'trae' ? 'trae' : 'codex');
						break;
					case 'codexApprovalResult':
						await this.handleCodexApprovalDecision(String(data.decision) as CodexApprovalDecision, data.requestId);
						break;
				}
			}
		);
	}

	private async handleAIMessage(message: string, model: string) {
		try {
			await this.agentInitializationPromise?.catch(() => undefined);
			// 显示正在思考的状态
			if (this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: true });
			}

			if (this.useAgentMode && this.agentBackend === 'codex') {
				const ready = await this.ensureCodexReady();
				if (ready) {
					await this.executeCodexAgentTurn(message);
					return;
				} else {
					vscode.window.showWarningMessage('Codex Agent 未就绪，已回退到 Trae/DashScope 模式。');
					this.agentBackend = 'trae';
					await this.sendAgentStatus();
				}
			}

			let aiResponse: string | undefined;

			if (this.useAgentMode && this.traeAgent.isTraeAgentAvailableSync()) {
				// 根据执行模式选择 会话/一次性 的 Agent 处理
				aiResponse = this.useSessionMode 
					? await this.handleAgentSessionMessage(message)
					: await this.handleAgentMessage(message);
			} else {
				// 使用 DashScope 兼容 OpenAI 的流式接口返回
				await this.callDefaultModel(message, model);
			}

			// 非流式（Agent 模式）返回后追加消息并关闭打字状态
			if (aiResponse !== undefined && aiResponse.trim().length > 0 && this._view) {
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

	private async callDefaultModel(message: string, model: string) {
		if (this._view) {
			this._view.webview.postMessage({ command: 'startAssistantMessage' });
		}
		console.log('[NEXAIDE][Stream] startAssistantMessage sent (normal mode)');
		await this.callQwenAPIStream(message, model);
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

	private async initializeAgentBackend(forceRestart: boolean = false): Promise<void> {
		try {
			if (forceRestart && this.codexAgent) {
				await this.codexAgent.dispose();
				this.codexAgent = undefined;
				this.agentInitializationPromise = undefined;
			}

			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this._extensionUri.fsPath;
			const preferCodex = this.preferredAgentBackend === 'codex';

			if (preferCodex) {
				const codexAvailable = await CodexAgentService.detectAvailability(workspaceRoot);
				if (codexAvailable) {
					this.codexAgent = new CodexAgentService(workspaceRoot, this.codexBinaryPath);
					this.agentBackend = 'codex';
					this.registerCodexListeners();
					await this.codexAgent.ensureReady();
					await this.sendAgentStatus();
					return;
				}
			}

			this.agentBackend = 'trae';
		} catch (error) {
			this.agentBackend = 'trae';
			console.warn('[NEXAIDE] initializeAgentBackend failed', error);
		}

		await this.sendAgentStatus();
	}

	private registerCodexListeners(): void {
		if (!this.codexAgent) {
			return;
		}

		this.codexAgent.on('status', (payload: { text: string }) => {
			if (this._view && payload?.text) {
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'executing',
					progress: payload.text
				});
			}
		});

		this.codexAgent.on('error', (payload: { message: string }) => {
			if (payload?.message) {
				vscode.window.showWarningMessage(`Codex: ${payload.message}`);
			}
		});

		this.codexAgent.on('execApproval', (request: CodexExecApprovalRequest) => {
			this.handleCodexExecApproval(request);
		});

		this.sendAgentStatus().catch(() => undefined);
	}

	private handleCodexExecApproval(request: CodexExecApprovalRequest): void {
		this.codexPendingApprovalId = request.requestId;
		const commandText = Array.isArray(request.command) ? request.command.join(' ') : String(request.command);
		const toolCall = {
			name: 'codex_exec',
			parameters: {
				command: commandText,
				cwd: request.cwd
			}
		};

		if (this._view) {
			this._view.webview.postMessage({
				command: 'showToolCalls',
				toolCalls: [toolCall],
				approvalRequestId: request.requestId,
				approvalSource: 'codex'
			});
			this._view.webview.postMessage({
				command: 'addMessage',
				content: `🛠 Codex 生成了执行步骤：\`${commandText}\`\n请在终端执行或使用卡片下方的按钮批准/拒绝该命令。`,
				type: 'system'
			});
		}
	}

	private async executeCodexAgentTurn(message: string): Promise<void> {
		if (!this.codexAgent) {
			vscode.window.showWarningMessage('Codex agent 尚未初始化，已回退至普通模式。');
			return;
		}

		const ready = await this.codexAgent.ensureReady();
		if (!ready) {
			vscode.window.showWarningMessage('Codex agent 不可用，已回退至普通模式。');
			return;
		}

		const workingDirectory = await this.resolveWorkingDirectory();
		if (!workingDirectory) {
			vscode.window.showWarningMessage('未检测到工作目录。请先打开项目或选择一个文件夹后重试。');
			return;
		}

		if (this._view) {
			this._view.webview.postMessage({
				command: 'agentProgress',
				status: 'executing',
				progress: '🤖 Codex Agent 正在执行...'
			});
		}

		try {
			const response = await this.codexAgent.sendMessage(message, workingDirectory);
			if (this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'completed'
				});
				this._view.webview.postMessage({
					command: 'addMessage',
					content: `🤖 **Codex 响应:**\n\n${response}`,
					type: 'assistant'
				});
			}
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			if (this._view) {
				this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'error',
					error: errMsg
				});
				this._view.webview.postMessage({
					command: 'addMessage',
					content: `⚠️ Codex 执行失败：${errMsg}`,
					type: 'system'
				});
			}
		}
	}

	private async resolveWorkingDirectory(): Promise<string | undefined> {
		let workingDirectory = vscode.window.activeTextEditor
			? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.fsPath
			: undefined;

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

		return workingDirectory;
	}

	private async handleCodexApprovalDecision(decision: CodexApprovalDecision, requestId?: number | string) {
		if (!this.codexAgent) {
			return;
		}

		const approvalId = requestId ?? this.codexPendingApprovalId;
		if (typeof approvalId === 'undefined') {
			return;
		}

		try {
			await this.codexAgent.respondToExecApproval(approvalId, decision);
		} catch (error) {
			vscode.window.showWarningMessage(`Codex 审批失败：${error instanceof Error ? error.message : String(error)}`);
		} finally {
			this.codexPendingApprovalId = undefined;
		}
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

	public async createNewSession() {
		// 如果处于 Agent 会话模式，尝试结束服务端会话
		if (this.useAgentMode && this.useSessionMode && this.traeAgent.isTraeAgentAvailableSync()) {
			try {
				const finalizeInfo = await this.traeAgent.finalizeSession();
				if (this._view) {
					this._view.webview.postMessage({
						command: 'addMessage',
						content: `🧹 ${finalizeInfo}`,
						type: 'system'
					});
				}
			} catch {
				// 忽略清理失败
			}
		}
		// 清空当前聊天记录
		if (this._view) {
			this._view.webview.postMessage({ command: 'clearChat' });
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
				// 如果有工具调用，先展示工具卡片并阻塞最终消息，待前端确认后再发送
				if (result.toolCalls && result.toolCalls.length > 0) {
					this._pendingAssistantMessage = `🤖 **Agent 响应:**\n\n${result.content}`;
					this._pendingToolCalls = result.toolCalls;
					if (this._view) {
						this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
						this._view.webview.postMessage({
							command: 'showToolCalls',
							toolCalls: result.toolCalls
						});
						this._view.webview.postMessage({
							command: 'addMessage',
							content: '🧭 已生成执行步骤。请按卡片中的“在终端运行”，完成后点击“完成并继续”，我会继续回复。',
							type: 'system'
						});
					}
					return '';
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

	private async handleAgentSessionMessage(message: string): Promise<string> {
		try {
			// 显示 Agent 执行状态
			if (this._view) {
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'executing',
					progress: '🤖 Agent 会话中...'
				});
			}

			// 工作目录解析与选择
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
				return '❌ **Agent 会话失败:**\n\n未检测到工作目录。请在 VS Code 中打开项目或选择一个文件夹后重试。';
			}

			const result: TraeAgentResponse = await this.traeAgent.executeAgentSession(message, {
				timeout: 120000,
				workingDirectory,
				onProgress: (data: string) => {
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
					`- Agent 会话执行：连接 MCP 会话或回退 CLI\n` +
					`- 卡片工具：如生成会在工具卡片中展示`;
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
				if (result.toolCalls && result.toolCalls.length > 0) {
					this._pendingAssistantMessage = `🤖 **Agent 会话响应:**\n\n${result.content}`;
					this._pendingToolCalls = result.toolCalls;
					if (this._view) {
						this._view.webview.postMessage({ command: 'showTyping', isTyping: false });
						this._view.webview.postMessage({ command: 'showToolCalls', toolCalls: result.toolCalls });
						this._view.webview.postMessage({
							command: 'addMessage',
							content: '🧭 已生成执行步骤。请按卡片中的“在终端运行”，完成后点击“完成并继续”，我会继续回复。',
							type: 'system'
						});
					}
					return '';
				}
				return `🤖 **Agent 会话响应:**\n\n${result.content}`;
			} else {
				return `❌ **Agent 会话执行失败:**\n\n${result.error || '未知错误'}\n\n*已自动切换到普通模式，您可以继续对话。*`;
			}
		} catch (error) {
			if (this._view) {
				this._view.webview.postMessage({
					command: 'agentProgress',
					status: 'error'
				});
			}
			return `❌ **Agent 会话异常:**\n\n${error instanceof Error ? error.message : '未知错误'}\n\n*已自动切换到普通模式，您可以继续对话。*`;
		}
	}

	/**
	 * 切换 Agent 模式
	 */
	private async toggleAgentMode(): Promise<void> {
		const targetMode = !this.useAgentMode;
		let backendReady = true;

		if (targetMode) {
			backendReady = await this.ensureAgentReady();
			if (!backendReady) {
				this.useAgentMode = false;
				const backendName = this.agentBackend === 'codex' ? 'Codex Agent' : 'Trae-Agent';
				const warning = `⚠️ **模式切换:** ${backendName} 不可用，已保持在普通模式`;
				if (this._view) {
					this._view.webview.postMessage({
						command: 'agentModeToggled',
						enabled: false,
						available: false
					});
					this._view.webview.postMessage({
						command: 'addMessage',
						content: warning,
						type: 'system'
					});
				}
				vscode.window.showWarningMessage(warning.replace('⚠️ **模式切换:** ', ''));
				await this.sendAgentStatus();
				return;
			}
		}

		this.useAgentMode = targetMode;
		const modeText = this.useAgentMode ? `Agent 模式（${this.agentBackend === 'codex' ? 'Codex' : 'Trae'}）` : '普通聊天模式';
		const statusIcon = this.useAgentMode ? '🤖' : '💬';

		if (this._view) {
			this._view.webview.postMessage({
				command: 'agentModeToggled',
				enabled: this.useAgentMode,
				available: backendReady
			});
			this._view.webview.postMessage({
				command: 'addMessage',
				content: `${statusIcon} **模式切换:** 已切换到 ${modeText}`,
				type: 'system'
			});
		}

		vscode.window.showInformationMessage(`${statusIcon} 已切换到 ${modeText}`);
		await this.sendAgentStatus();
	}

	/**
	 * 停止 Agent 执行
	 */
	private stopAgentExecution(): void {
		if (this.agentBackend === 'codex' && this.codexAgent) {
			this.codexAgent.interruptCurrentTurn();
		} else {
			this.traeAgent.stopExecution();
		}
		
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
		this.sendAgentStatus();
	}

	/**
	 * 发送 Agent 信息
	 */
	private async sendAgentInfo(): Promise<void> {
		try {
			const [traeInfoRaw, traeAvailable] = await Promise.all([
				this.traeAgent.getAgentInfo(),
				this.traeAgent.isTraeAgentAvailable()
			]);
			const agentPath = this.traeAgent.getTraeAgentPath();
			const codexConfigured = !!(this.codexAgent || this.codexBinaryPath || process.env.NEXAIDE_CODEX_PATH);
			const codexReady = this.codexAgent?.isAvailable() ?? false;
			const codexPath = this.codexBinaryPath || process.env.NEXAIDE_CODEX_PATH || 'codex (PATH)';
			const codexStatus = codexReady
				? `✅ Codex Agent 可用（${codexPath}）`
				: (codexConfigured
					? `⏳ Codex Agent 正在初始化（配置：${codexPath}）`
					: '⚠️ 未检测到 Codex CLI。请运行 `npm i -g @openai/codex` 并执行 `codex login`，或在设置中填写 `nexaide.codex.binaryPath`。');
			const traeStatus = traeAvailable
				? '✅ Trae-Agent 可用'
				: '⚠️ Trae-Agent 不可用，请确认 `nexaide.traeAgent.path` 指向仓库并已执行 `uv sync --all-extras`。';
			const traeInfo = typeof traeInfoRaw === 'string' ? traeInfoRaw : JSON.stringify(traeInfoRaw, null, 2);
			const infoMessage = [
				'🤖 **Agent 配置总览**',
				`• 当前后端: ${this.agentBackend === 'codex' ? 'Codex Agent' : 'Trae-Agent'}`,
				`• 首选后端: ${this.preferredAgentBackend === 'codex' ? 'Codex Agent' : 'Trae-Agent'}`,
				`• Codex: ${codexStatus}`,
				`• Trae-Agent: ${traeStatus}（路径：\`${agentPath}\`）`,
				`• Agent 模式: ${this.useAgentMode ? '🤖 Agent 模式' : '💬 普通模式'}`,
				`• 执行模式: ${this.useSessionMode ? '🌀 会话模式' : '⚡ 一次性模式'}`,
				'',
				'🛠 **Trae-Agent 配置信息**',
				'```',
				traeInfo,
				'```'
			].join('\n');
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

	private async ensureCodexReady(): Promise<boolean> {
		try {
			await this.agentInitializationPromise?.catch(() => undefined);
			if (!this.codexAgent) {
				return false;
			}
			return await this.codexAgent.ensureReady();
		} catch {
			return false;
		}
	}

	private async ensureAgentReady(): Promise<boolean> {
		if (this.agentBackend === 'codex') {
			return this.ensureCodexReady();
		}
		return this.traeAgent.isTraeAgentAvailable();
	}

	private async updateAgentBackendPreference(backend: 'codex' | 'trae'): Promise<void> {
		const config = vscode.workspace.getConfiguration('nexaide');
		await config.update('agentBackend', backend, vscode.ConfigurationTarget.Global);
		await this.reloadConfiguration();
	}

	private async sendAgentStatus(): Promise<void> {
		if (!this._view) {
			return;
		}

		let traeAvailable = false;
		try {
			traeAvailable = await this.traeAgent.isTraeAgentAvailable();
		} catch {
			traeAvailable = false;
		}

		let codexAvailable = false;
		if (this.codexAgent) {
			try {
				codexAvailable = this.codexAgent.isAvailable() || await this.codexAgent.ensureReady();
			} catch {
				codexAvailable = false;
			}
		}

		const activeBackend = this.agentBackend;
		const infoLines = [
			traeAvailable
				? '✅ Trae-Agent 可用'
				: '⚠️ Trae-Agent 不可用，请在设置中配置 `nexaide.traeAgent.path` 并执行 `uv sync --all-extras`。',
			(this.codexAgent || this.preferredAgentBackend === 'codex')
				? (
					codexAvailable
						? '✅ Codex Agent 可用'
						: '⚠️ Codex Agent 未就绪，请安装 `@openai/codex` 并运行 `codex login`，或在设置中填写 `nexaide.codex.binaryPath`。'
				)
				: 'ℹ️ 当前未启用 Codex Agent（可通过下拉框或设置进行切换）。',
			`当前后端: ${activeBackend === 'codex' ? 'Codex Agent' : 'Trae-Agent'}`,
			`首选后端: ${this.preferredAgentBackend === 'codex' ? 'Codex Agent' : 'Trae-Agent'}`
		];

		try {
			await this._view.webview.postMessage({
				command: 'agentStatus',
				available: traeAvailable || codexAvailable,
				info: infoLines.join('\n'),
				codexAvailable,
				traeAvailable,
				activeBackend,
				preferredBackend: this.preferredAgentBackend
			});
		} catch (error) {
			console.warn('[NEXAIDE] sendAgentStatus postMessage failed', error);
		}
	}

	public async dispose(): Promise<void> {
		this.configurationListener?.dispose();
		if (this.codexAgent) {
			await this.codexAgent.dispose();
			this.codexAgent = undefined;
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

