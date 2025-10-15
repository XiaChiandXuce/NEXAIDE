import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface TraeAgentResponse {
    success: boolean;
    content: string;
    error?: string;
    toolCalls?: ToolCall[];
    // 执行模式标识：MCP 或 CLI
    mode?: 'mcp' | 'cli';
}

export interface ToolCall {
    name: string;
    parameters: any;
    result?: string;
}

export class TraeAgentService {
    private traeAgentPath: string;
    private traeCommand = 'D:\\TYHProjectLibrary\\AICcompiler\\NEXAIDE\\trae-agent-main\\.venv\\Scripts\\trae-cli.exe';
    private isAvailable: boolean = false;
    private currentProcess: ChildProcess | null = null;
    private initializationPromise: Promise<void>;
    // MCP 客户端相关属性
    private mcpClient: Client | null = null;
    private mcpTransport: StdioClientTransport | null = null;
    private mcpConnectingPromise: Promise<boolean> | undefined;

    constructor(extensionPath: string) {
        // 使用正确的 trae-agent-main 路径
        this.traeAgentPath = 'D:\\TYHProjectLibrary\\AICcompiler\\NEXAIDE\\trae-agent-main';
        this.initializationPromise = this.checkAvailability();
    }

    /**
     * 检查 trae-agent 是否可用
     */
    private async checkAvailability(): Promise<void> {
        return new Promise((resolve) => {
            try {
                // 检查 trae-agent 目录是否存在
                if (!fs.existsSync(this.traeAgentPath)) {
                    console.warn('Trae-agent directory not found:', this.traeAgentPath);
                    this.isAvailable = false;
                    resolve();
                    return;
                }

                // 检查 trae-cli.exe 是否存在
                if (!fs.existsSync(this.traeCommand)) {
                    console.warn('Trae-cli.exe not found:', this.traeCommand);
                    this.isAvailable = false;
                    resolve();
                    return;
                }

                // 尝试运行 trae-cli --help 来验证安装
                const testProcess = spawn(this.traeCommand, ['--help'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                testProcess.on('close', (code) => {
                    this.isAvailable = code === 0;
                    if (!this.isAvailable) {
                        console.warn('Trae-agent is not properly installed or configured');
                    } else {
                        console.log('Trae-agent is available and ready');
                    }
                    resolve();
                });

                testProcess.on('error', (error) => {
                    console.error('Error checking trae-agent availability:', error);
                    this.isAvailable = false;
                    resolve();
                });

            } catch (error) {
                console.error('Error in checkAvailability:', error);
                this.isAvailable = false;
                resolve();
            }
        });
    }

    /**
     * 检查 trae-agent 是否可用
     */
    public async isTraeAgentAvailable(): Promise<boolean> {
        await this.initializationPromise;
        return this.isAvailable;
    }

    /**
     * 同步检查 trae-agent 是否可用（不等待初始化）
     */
    public isTraeAgentAvailableSync(): boolean {
        return this.isAvailable;
    }

    // 调试开关（通过环境变量 NEXAIDE_DEBUG=1/true 启用）
    private isDebug(): boolean {
        return process.env.NEXAIDE_DEBUG === '1' || process.env.NEXAIDE_DEBUG === 'true';
    }

    // 调试输出工具：控制台 +（可选）进度面板
    private logDebug(message: string, onProgress?: (data: string) => void): void {
        const line = `[DEBUG TraeAgentService] ${message}\n`;
        console.log(line.trim());
        if (onProgress && this.isDebug()) {
            onProgress(line);
        }
    }

    // 建立 MCP 连接（若已连接则复用）
    private async ensureMCPConnected(): Promise<boolean> {
        if (this.mcpClient) {
            return true;
        }
        if (this.mcpConnectingPromise) {
            return this.mcpConnectingPromise;
        }
        this.mcpConnectingPromise = (async () => {
            try {
                const pythonPath = path.join(this.traeAgentPath, '.venv', 'Scripts', 'python.exe');
                const serverPath = path.join(this.traeAgentPath, 'mcp_server.py');
                this.logDebug(`MCP connecting: python=${pythonPath}, server=${serverPath}`);

                const filteredEnv = Object.fromEntries(
                    Object.entries(process.env).filter(([_, v]) => typeof v === 'string')
                ) as Record<string, string>;
                const env: Record<string, string> = { ...filteredEnv, PYTHONUNBUFFERED: '1' };

                this.mcpTransport = new StdioClientTransport({
                    command: pythonPath,
                    args: [serverPath],
                    env,
                    cwd: this.traeAgentPath,
                });

                this.mcpClient = new Client({
                    name: 'nexaide-plugin',
                    version: '0.1.0',
                });

                // 可选：注册能力（roots）
                this.mcpClient.registerCapabilities({
                    roots: {},
                });

                await this.mcpClient.connect(this.mcpTransport, { timeout: 60000 });
                this.logDebug('MCP connected successfully');
                return true;
            } catch (err) {
                console.error('MCP 连接失败:', err);
                this.logDebug(`MCP connect failed: ${err instanceof Error ? err.message : String(err)}`);
                this.mcpClient = null;
                this.mcpTransport = null;
                return false;
            } finally {
                this.mcpConnectingPromise = undefined;
            }
        })();
        return this.mcpConnectingPromise;
    }

    /**
     * 执行 trae-agent 命令（优先 MCP，CLI 回退）
     */
    public async executeAgent(
        message: string, 
        options: {
            timeout?: number;
            maxDuration?: number;
            workingDirectory?: string;
            onProgress?: (data: string) => void;
        } = {}
    ): Promise<TraeAgentResponse> {
        if (!this.isAvailable) {
            return {
                success: false,
                content: '',
                error: 'Trae-agent is not available. Please ensure it is properly installed.'
            };
        }

        if (!options.workingDirectory) {
            return {
                success: false,
                content: '',
                error: '未检测到项目工作目录。请先打开项目根目录或在界面中选择工作目录后再执行 Agent。'
            };
        }
        const workingDir = options.workingDirectory;

        // 优先尝试 MCP 调用
        try {
            if (options.onProgress) {
                options.onProgress('🔌 正在连接 MCP 服务器...\n');
            }
            // 初始化 MCP 客户端连接
            const connected = await this.ensureMCPConnected();
            if (connected && this.mcpClient) {
                const args: Record<string, unknown> = { message, working_directory: workingDir };
                const result: any = await this.mcpClient.callTool({ name: 'run_trae_agent', arguments: args });
                let text = '';
                if (result && Array.isArray(result.content)) {
                    for (const item of result.content) {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            text += item.text;
                        }
                    }
                }
                if (text) {
                    return { success: true, content: text, mode: 'mcp' };
                }
            }
        } catch (e) {
            if (options.onProgress) {
                options.onProgress(`⚠ MCP 调用失败，回退到 CLI：${e instanceof Error ? e.message : String(e)}\n`);
            }
        }

        // CLI 回退逻辑
        return new Promise((resolve) => {
            const timeout = options.timeout ?? 300000; // 默认300秒不活动窗口
            const maxDuration = options.maxDuration ?? 900000; // 总时长上限15分钟
            
            let output = '';
            let errorOutput = '';
            let isResolved = false;

            // 为本次执行生成唯一的轨迹文件路径
            const trajectoryPath = this.buildTrajectoryPath();

            // 创建子进程，使用配置文件
            const configPath = path.join(this.traeAgentPath, 'trae_config.yaml');
            const args = ['run', message, '--config-file', configPath, '--console-type', 'simple', '--trajectory-file', trajectoryPath, '--working-dir', workingDir];
            this.logDebug(`Launching CLI: ${this.traeCommand} ${JSON.stringify(args)}` , options.onProgress);
            this.currentProcess = spawn(this.traeCommand, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: workingDir,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
            });

            // 设置超时（基于不活动窗口）
            let timeoutId: NodeJS.Timeout;
            let overallTimeoutId: NodeJS.Timeout;
            const onTimeout = () => {
                if (!isResolved && this.currentProcess) {
                    this.currentProcess.kill('SIGTERM');
                    isResolved = true;
                    resolve({
                        success: false,
                        content: this.sanitizeOutput(output),
                        error: 'Trae-agent execution timed out'
                    });
                }
            };
            const onOverallTimeout = () => {
                if (!isResolved && this.currentProcess) {
                    this.currentProcess.kill('SIGTERM');
                    isResolved = true;
                    resolve({
                        success: false,
                        content: this.sanitizeOutput(output),
                        error: 'Trae-agent execution reached max total duration'
                    });
                }
            };
            const refreshTimeout = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(onTimeout, timeout);
            };
            refreshTimeout();
            overallTimeoutId = setTimeout(onOverallTimeout, maxDuration);

            // 处理标准输出
            this.currentProcess.stdout?.on('data', (data) => {
                const chunkRaw = data.toString();
                this.logDebug(`stdout raw: ${JSON.stringify(chunkRaw)}`, options.onProgress);
                const chunk = this.sanitizeOutput(chunkRaw);
                output += chunk;
                refreshTimeout();
                
                // 如果有进度回调，调用它
                if (options.onProgress) {
                    options.onProgress(chunk);
                }
            });

            // 处理错误输出
            this.currentProcess.stderr?.on('data', (data) => {
                const errRaw = data.toString();
                this.logDebug(`stderr raw: ${JSON.stringify(errRaw)}`, options.onProgress);
                errorOutput += this.sanitizeOutput(errRaw);
                refreshTimeout();
            });

            // 处理进程结束
            this.currentProcess.on('close', (code) => {
                this.logDebug(`process close with code: ${code}`, options.onProgress);
                clearTimeout(timeoutId);
                clearTimeout(overallTimeoutId);
                this.currentProcess = null;
                
                if (!isResolved) {
                    isResolved = true;

                    // 优先解析轨迹文件，获取结构化结果
                    const traj = this.parseTrajectoryFile(trajectoryPath);
                    this.logDebug(`trajectory parsed: ${traj ? 'yes' : 'no'}`, options.onProgress);
                    const finalContent = traj?.final_result ?? this.sanitizeOutput(output.trim());
                    const toolCalls = traj?.toolCalls ?? this.parseToolCalls(output);
                    const success = code === 0 && (traj?.success !== false);
                    
                    if (code === 0) {
                        resolve({
                            success,
                            content: finalContent,
                            toolCalls,
                            mode: 'cli',
                        });
                    } else {
                        resolve({
                            success: false,
                            content: finalContent,
                            error: errorOutput.trim() || `Process exited with code ${code}`,
                            mode: 'cli',
                        });
                    }
                }
            });

            // 处理进程错误
            this.currentProcess.on('error', (error) => {
                this.logDebug(`process error: ${error.message}`, options.onProgress);
                clearTimeout(timeoutId);
                clearTimeout(overallTimeoutId);
                this.currentProcess = null;
                
                if (!isResolved) {
                    isResolved = true;
                    resolve({
                        success: false,
                        content: this.sanitizeOutput(output),
                        error: `Process error: ${error.message}`,
                        mode: 'cli',
                    });
                }
            });
        });
    }

    /**
     * 中断当前执行的 agent
     */
    public stopExecution(): void {
        if (this.currentProcess) {
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
        }
    }

    /**
     * 清理输出中的 ANSI 控制符并规范换行，避免颜色码与编码造成的乱码
     */
    private sanitizeOutput(text: string): string {
        // 移除 ANSI 控制符
        const ansiRegex = /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        let cleaned = text.replace(ansiRegex, '');
        // 去除 rich 风格标记（如 [bold]、[/bold]、[cyan]、[#xxxxxx] 等）
        cleaned = cleaned.replace(/\[(?:\/?)[a-zA-Z][\w-]*(?:=[^\]]+)?\]/g, '');
        // 去除 Unicode 表格线与框线字符 U+2500-U+257F
        cleaned = cleaned.replace(/[\u2500-\u257F]/g, '');
        // 规范换行
        return cleaned.replace(/\r?\n/g, '\n');
    }

    /**
     * 解析工具调用信息（简单实现）
     */
    private parseToolCalls(output: string): ToolCall[] {
        const toolCalls: ToolCall[] = [];
        
        // 这里可以根据 trae-agent 的输出格式来解析工具调用
        // 目前是一个简单的实现，可以根据实际输出格式进行调整
        const toolCallRegex = /Tool: (\w+)\s*\(([^)]+)\)/g;
        let match;
        
        while ((match = toolCallRegex.exec(output)) !== null) {
            toolCalls.push({
                name: match[1],
                parameters: match[2],
                result: 'Executed' // 可以进一步解析结果
            });
        }
        
        return toolCalls;
    }

    // 生成唯一轨迹文件路径（位于 trae-agent-main/trajectories 下）
    private buildTrajectoryPath(): string {
        const ts = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timestamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
        const fname = `trajectory_${timestamp}_${Math.floor(Math.random() * 1000000)}.json`;
        return path.join(this.traeAgentPath, 'trajectories', fname);
    }

    // 解析轨迹 JSON，提取最终结果与工具调用
    private parseTrajectoryFile(filePath: string): { success?: boolean; final_result?: string; toolCalls?: ToolCall[] } | null {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
            const data = JSON.parse(raw);

            const success: boolean | undefined = data?.success;
            const final_result: string | undefined = data?.final_result ?? undefined;

            const toolCalls: ToolCall[] = [];
            const resultsById = new Map<string, string | undefined>();

            // 1) 先收集所有可能位置的 tool_results，建立 call_id -> result 映射
            const collectResults = (arr: any[]) => {
                for (const tr of arr) {
                    const cid = tr?.call_id;
                    if (cid !== undefined && cid !== null) {
                        resultsById.set(String(cid), tr?.result);
                    }
                }
            };

            // 顶层 tool_results
            if (Array.isArray(data?.tool_results)) {
                collectResults(data.tool_results);
            }
            // agent_steps.*.tool_results
            const steps: any[] = Array.isArray(data?.agent_steps) ? data.agent_steps : [];
            for (const step of steps) {
                if (Array.isArray(step?.tool_results)) {
                    collectResults(step.tool_results);
                }
            }

            // 2) 收集所有可能位置的 tool_calls，并关联对应结果
            const collectCalls = (arr: any[]) => {
                for (const tc of arr) {
                    const cid = tc?.call_id ? String(tc.call_id) : undefined;
                    const name = tc?.name ?? 'unknown_tool';
                    const params = (tc?.arguments ?? tc?.parameters ?? {});
                    const result = cid ? resultsById.get(cid) : undefined;
                    toolCalls.push({ name, parameters: params, result });
                }
            };

            // 顶层 tool_calls
            if (Array.isArray(data?.tool_calls)) {
                collectCalls(data.tool_calls);
            }
            // agent_steps.*.tool_calls
            for (const step of steps) {
                if (Array.isArray(step?.tool_calls)) {
                    collectCalls(step.tool_calls);
                }
            }

            return { success, final_result, toolCalls };
        } catch (e) {
            this.logDebug(`trajectory parse failed: ${e instanceof Error ? e.message : String(e)}`);
            return null; // 解析失败时回退到 stdout
        }
    }

    /**
     * 获取 trae-agent 配置信息（优先 MCP，CLI 回退）
     */
    public async getAgentInfo(): Promise<string> {
        if (!this.isAvailable) {
            return 'Trae-agent is not available';
        }

        // 优先使用 MCP 获取配置
        try {
            const connected = await this.ensureMCPConnected();
            if (connected && this.mcpClient) {
                const result: any = await this.mcpClient.callTool({ name: 'get_trae_config', arguments: {} });
                let text = '';
                if (result && Array.isArray(result.content)) {
                    for (const item of result.content) {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            text += item.text;
                        }
                    }
                }
                if (text) {
                    return text.trim();
                }
            }
        } catch (e) {
            // 忽略 MCP 错误，回退到 CLI
        }

        // 回退到 CLI show-config
        try {
            const configPath = path.join(this.traeAgentPath, 'trae_config.yaml');
            
            return new Promise((resolve) => {
                const process = spawn(this.traeCommand, ['show-config', '--config-file', configPath], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let output = '';
                let errorOutput = '';
                
                process.stdout?.on('data', (data) => {
                    output += data.toString();
                });
                
                process.stderr?.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve(output.trim());
                    } else {
                        resolve(`Failed to get agent info: ${errorOutput.trim() || 'Unknown error'}`);
                    }
                });
                
                process.on('error', (error) => {
                    resolve(`Error getting agent info: ${error.message}`);
                });
            });
        } catch (error) {
            return `Error getting agent info: ${error}`;
        }
    }

    /**
     * 设置 trae-agent 路径
     */
    public setTraeAgentPath(newPath: string): void {
        this.traeAgentPath = newPath;
        this.checkAvailability();
    }

    /**
     * 获取当前 trae-agent 路径
     */
    public getTraeAgentPath(): string {
        return this.traeAgentPath;
    }
}