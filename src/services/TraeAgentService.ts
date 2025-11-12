import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

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
    private traeCommand: string;
    private isAvailable: boolean = false;
    private currentProcess: ChildProcess | null = null;
    private initializationPromise: Promise<void>;
    // MCP 客户端相关属性
    private mcpClient: Client | null = null;
    private mcpTransport: StdioClientTransport | null = null;
    private mcpConnectingPromise: Promise<boolean> | undefined;
    private lastMCPIssue: string | null = null;
    private mcpStderrBuffer: string[] = [];

    constructor(extensionPath: string) {
        // 解析 trae-agent-main 路径：优先环境变量，其次工作区与 extensionPath 的相对位置
        const envOverride = process.env.NEXAIDE_TRAE_AGENT_PATH?.trim();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        const candidates: string[] = [];

        if (envOverride) {
            candidates.push(envOverride);
        }
        if (workspaceRoot) {
            candidates.push(path.join(workspaceRoot, 'trae-agent-main'));
            candidates.push(path.join(workspaceRoot, '..', 'trae-agent-main'));
        }
        // 基于扩展安装目录的常见相对位置
        candidates.push(path.join(extensionPath, '..', '..', 'trae-agent-main'));
        candidates.push(path.join(extensionPath, '..', 'trae-agent-main'));
        candidates.push(path.join(extensionPath, 'trae-agent-main'));

        const cliName = process.platform === 'win32' ? 'trae-cli.exe' : 'trae-cli';
        const uniqueCandidates = Array.from(new Set(candidates.filter((item): item is string => !!item)));

        const hasRepoMarkers = (candidate: string): boolean => {
            const markers = [
                'trae_agent',
                'pyproject.toml',
                'trae_config.yaml',
                path.join('trae_agent', 'cli.py')
            ];
            return markers.some((marker) => {
                try {
                    return fs.existsSync(path.join(candidate, marker));
                } catch {
                    return false;
                }
            });
        };

        const findLocalTraeCli = (candidate: string): string | undefined => {
            const scriptDirs = process.platform === 'win32'
                ? [path.join(candidate, '.venv', 'Scripts')]
                : [path.join(candidate, '.venv', 'bin'), path.join(candidate, '.venv', 'Scripts')];
            const cliCandidates = process.platform === 'win32' ? ['trae-cli.exe', 'trae-cli'] : ['trae-cli'];
            for (const dir of scriptDirs) {
                for (const cli of cliCandidates) {
                    const fullPath = path.join(dir, cli);
                    try {
                        if (fs.existsSync(fullPath)) {
                            return fullPath;
                        }
                    } catch {
                        // ignore
                    }
                }
            }
            return undefined;
        };

        const resolveTraeAgentPath = (paths: string[]): string | null => {
            for (const p of paths) {
                if (!p) {
                    continue;
                }
                try {
                    if (fs.existsSync(p) && hasRepoMarkers(p)) {
                        return p;
                    }
                } catch {
                    // ignore
                }
            }
            return null;
        };

        const resolved = resolveTraeAgentPath(uniqueCandidates) ?? envOverride ?? path.join(process.cwd(), 'trae-agent-main');
        this.traeAgentPath = resolved;

        const localCli = this.traeAgentPath ? findLocalTraeCli(this.traeAgentPath) : undefined;
        this.traeCommand = localCli ?? cliName;

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
                const commandLooksLikePath = path.isAbsolute(this.traeCommand) || this.traeCommand.includes(path.sep);
                if (commandLooksLikePath && !fs.existsSync(this.traeCommand)) {
                    console.warn('[NEXAIDE] Trae CLI not found:', this.traeCommand, 'Please run \"uv sync --all-extras\" inside the Trae repository.');
                    this.isAvailable = false;
                    resolve();
                    return;
                }

                // 尝试运行 trae-cli --help 来验证安装
                const testProcess = spawn(this.traeCommand, ['--help'], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: this.traeAgentPath,
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
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
                this.lastMCPIssue = null;
                this.mcpStderrBuffer = [];
                const pythonPath = path.join(this.traeAgentPath, '.venv', 'Scripts', 'python.exe');
                const serverPath = path.join(this.traeAgentPath, 'mcp_server.py');
                // 使用内联入口修复服务端初始化 capabilities 时的 None 访问错误
                const wrapperCode = [
                    'import sys, asyncio',
                    `sys.path.insert(0, r"${this.traeAgentPath.replace(/\\/g, '\\\\')}")`,
                    'from mcp.server.stdio import stdio_server',
                    'from mcp.server.lowlevel.server import NotificationOptions',
                    'from mcp.server.models import InitializationOptions',
                    'from mcp_server import TraeAgentMCPServer',
                    'async def main():',
                    '    s=TraeAgentMCPServer(); s.setup_handlers()',
                    '    async with stdio_server() as (r,w):',
                    '        await s.server.run(r,w, InitializationOptions(server_name="trae-agent", server_version="1.0.0", capabilities=s.server.get_capabilities(notification_options=NotificationOptions(), experimental_capabilities={}),))',
                    'asyncio.run(main())'
                ].join('\n');
                const useWrapper = true; // 始终使用更稳健的入口以避免服务端已知缺陷
                this.logDebug(`MCP connecting: python=${pythonPath}, server=${serverPath}, useWrapper=${useWrapper}`);

                const filteredEnv = Object.fromEntries(
                    Object.entries(process.env).filter(([_, v]) => typeof v === 'string')
                ) as Record<string, string>;
                // 强化 Windows 下的编码与路径环境，避免 JSON/Unicode 解析问题与包导入失败
                const env: Record<string, string> = {
                    ...filteredEnv,
                    PYTHONUNBUFFERED: '1',
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUTF8: '1',
                    PYTHONPATH: this.traeAgentPath,
                };

                this.mcpTransport = new StdioClientTransport({
                    command: pythonPath,
                    args: useWrapper ? ['-c', wrapperCode] : [serverPath],
                    env,
                    cwd: this.traeAgentPath,
                    stderr: 'pipe', // 将 stderr 管道化，便于捕获错误输出
                });

                // 预先挂载 stderr 监听，避免丢失早期报错
                try {
                    const stderr = (this.mcpTransport as any).stderr;
                    if (stderr && typeof stderr.on === 'function') {
                        stderr.on('data', (chunk: Buffer | string) => {
                            const text = chunk instanceof Buffer ? chunk.toString('utf-8') : String(chunk);
                            const line = text.trim();
                            // 记录最近 50 行 stderr，便于失败时展示尾部
                            if (line) {
                                this.mcpStderrBuffer.push(line);
                                if (this.mcpStderrBuffer.length > 50) {
                                    this.mcpStderrBuffer.shift();
                                }
                            }
                            this.logDebug(`MCP stderr: ${line}`);
                        });
                    }
                } catch (hookErr) {
                    this.logDebug(`Attach MCP stderr listener failed: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`);
                }

                // 传输层错误/关闭监听
                try {
                    (this.mcpTransport as any).onerror = (error: any) => {
                        this.logDebug(`MCP transport error: ${error instanceof Error ? error.message : String(error)}`);
                    };
                    (this.mcpTransport as any).onclose = () => {
                        this.logDebug('MCP transport closed');
                    };
                } catch { /* noop */ }

                this.mcpClient = new Client({
                    name: 'nexaide-plugin',
                    version: '0.1.0',
                });

                this.mcpClient.registerCapabilities({
                    roots: {},
                });

                const connectTimeoutMs = vscode.workspace.getConfiguration('nexaide').get<number>('mcp.connectTimeoutMs') ?? 120000;
                await this.mcpClient.connect(this.mcpTransport, { timeout: connectTimeoutMs });
                this.lastMCPIssue = 'connected';

                // 记录服务器能力与 PID
                try {
                    const caps = (this.mcpClient as any).getServerCapabilities?.();
                    const pid = (this.mcpTransport as any).pid;
                    this.logDebug(`MCP server caps: ${JSON.stringify(caps)}, pid: ${pid}`);
                } catch { /* noop */ }

                // 连接后主动列举工具，确保 run_trae_agent 可用
                try {
                    const tools = await (this.mcpClient as any).listTools?.();
                    if (Array.isArray(tools?.tools)) {
                        const hasRunTool = tools.tools.some((t: any) => t?.name === 'run_trae_agent');
                        if (!hasRunTool) {
                            this.logDebug('MCP connected but run_trae_agent not found');
                            this.lastMCPIssue = 'run_trae_agent not found in tools';
                            this.mcpClient = null;
                            this.mcpTransport = null;
                            return false;
                        }
                    }
                } catch (listErr) {
                    this.logDebug(`MCP listTools failed: ${listErr instanceof Error ? listErr.message : String(listErr)}`);
                    const tail = this.mcpStderrBuffer.slice(-6).join(' | ');
                    this.lastMCPIssue = `listTools failed: ${listErr instanceof Error ? listErr.message : String(listErr)}${tail ? '; stderr: ' + tail : ''}`;
                    this.mcpClient = null;
                    this.mcpTransport = null;
                    return false;
                }

                this.logDebug('MCP connected successfully');
                return true;
            } catch (err) {
                console.error('MCP 连接失败:', err);
                const msg = err instanceof Error ? err.message : String(err);
                this.logDebug(`MCP connect failed: ${msg}`);
                const tail = this.mcpStderrBuffer.slice(-6).join(' | ');
                this.lastMCPIssue = `connect failed: ${msg}${tail ? '; stderr: ' + tail : ''}`;
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
                const mcpTimeout = (options?.maxDuration ?? 600000); // 默认 10 分钟
                this.logDebug(`MCP callTool timeout=${mcpTimeout}ms`, options.onProgress);
                const result: any = await (this.mcpClient as any).callTool(
                    { name: 'run_trae_agent', arguments: args },
                    CallToolResultSchema,
                    { timeout: mcpTimeout }
                );
                let text = '';
                if (result && Array.isArray(result.content)) {
                    for (const item of result.content) {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            text += item.text;
                        }
                    }
                }
                if (text) {
                    options.onProgress?.('✅ Agent 使用 MCP 模式\n');
                    this.lastMCPIssue = null;
                    return { success: true, content: text, mode: 'mcp' };
                } else {
                    const reason = 'MCP 工具返回内容为空';
                    this.lastMCPIssue = reason;
                    options.onProgress?.(`ℹ ${reason}，回退到 CLI 模式\n`);
                }
            } else {
                options.onProgress?.(`ℹ MCP 未就绪（原因：${this.lastMCPIssue ?? '未知'}），回退到 CLI 模式\n`);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const tail = this.mcpStderrBuffer.slice(-6).join(' | ');
            this.lastMCPIssue = `callTool error: ${msg}${tail ? '; stderr: ' + tail : ''}`;
            if (options.onProgress) {
                options.onProgress(`⚠ MCP 调用失败（原因：${msg}${tail ? '；stderr尾部：' + tail : ''}），回退到 CLI\n`);
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
                        options.onProgress?.('✅ Agent 使用 CLI 模式\n');
                        resolve({
                            success,
                            content: finalContent,
                            toolCalls,
                            mode: 'cli',
                        });
                    } else {
                        options.onProgress?.('✅ Agent 使用 CLI 模式（进程非零退出）\n');
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

    // 会话模式：优先 MCP 的 start_agent_session/inject_observation，失败时回退 CLI 一次性
    public async executeAgentSession(
        message: string,
        options: {
            timeout?: number;
            maxDuration?: number;
            workingDirectory?: string;
            onProgress?: (data: string) => void;
        } = {}
    ): Promise<TraeAgentResponse> {
        if (!this.isAvailable) {
            return { success: false, content: '', error: 'Trae-agent is not available. Please ensure it is properly installed.' };
        }
        if (!options.workingDirectory) {
            return { success: false, content: '', error: '未检测到项目工作目录。请先打开项目根目录或在界面中选择工作目录后再执行 Agent。' };
        }
        const workingDir = options.workingDirectory;

        try {
            options.onProgress?.('🔌 正在连接 MCP 服务器...\n');
            const connected = await this.ensureMCPConnected();
            if (connected && this.mcpClient) {
                // 读取会话状态，仅在 WAITING 时才进行注入
                let sessionState: string | null = null;
                try {
                    const statusRes: any = await (this.mcpClient as any).callTool(
                        { name: 'get_session_status', arguments: {} },
                        CallToolResultSchema,
                        { timeout: options.maxDuration ?? 600000 }
                    );
                    let statusText = '';
                    if (statusRes && Array.isArray(statusRes.content)) {
                        for (const item of statusRes.content) {
                            if (item.type === 'text' && typeof item.text === 'string') {
                                statusText += item.text;
                            }
                        }
                    }
                    const trimmed = statusText.trim();
                    if (trimmed && !/^No active session/i.test(trimmed)) {
                        try {
                            const obj = JSON.parse(trimmed);
                            sessionState = obj?.state ?? null;
                        } catch {
                            sessionState = 'UNKNOWN';
                        }
                    }
                } catch { /* ignore */ }

                const isWaiting = sessionState === 'WAITING';
                const callName = isWaiting ? 'inject_observation' : 'start_agent_session';
                const args = isWaiting
                    ? { observation: message }
                    : { message, project_path: workingDir, issue: message };

                this.logDebug(`MCP session call: ${callName}`, options.onProgress);
                const result: any = await (this.mcpClient as any).callTool(
                    { name: callName, arguments: args },
                    CallToolResultSchema,
                    { timeout: options.maxDuration ?? 600000 }
                );
                let text = '';
                if (result && Array.isArray(result.content)) {
                    for (const item of result.content) {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            text += item.text;
                        }
                    }
                }

                if (text) {
                    let success = true;
                    let content = text;
                    if (/^\s*Error:/i.test(text)) {
                        success = false;
                    }
                    try {
                        const obj = JSON.parse(text);
                        if (typeof obj === 'object' && obj) {
                            success = obj.success !== false;
                            content = obj.final_result && String(obj.final_result).trim()
                                ? String(obj.final_result)
                                : `状态: ${obj.state ?? 'UNKNOWN'}\n步骤: ${obj.steps ?? 0}`;
                        }
                    } catch {
                        // 非 JSON，保留原始文本
                    }

                    if (success) {
                        options.onProgress?.('✅ Agent 使用 MCP 会话模式\n');
                        this.lastMCPIssue = null;
                    } else {
                        options.onProgress?.('⚠ MCP 会话工具返回错误\n');
                        this.lastMCPIssue = 'MCP 会话工具返回错误';
                    }
                    return { success, content, mode: 'mcp' };
                } else {
                    const reason = 'MCP 会话工具返回内容为空';
                    this.lastMCPIssue = reason;
                    options.onProgress?.(`ℹ ${reason}，回退到 CLI 一次性模式\n`);
                }
            } else {
                options.onProgress?.(`ℹ MCP 未就绪（原因：${this.lastMCPIssue ?? '未知'}），回退到 CLI 一次性\n`);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const tail = this.mcpStderrBuffer.slice(-6).join(' | ');
            this.lastMCPIssue = `callTool error: ${msg}${tail ? '; stderr: ' + tail : ''}`;
            options.onProgress?.(`⚠ MCP 会话调用失败（原因：${msg}${tail ? '；stderr尾部：' + tail : ''}），回退到 CLI\n`);
        }

        // 回退到一次性 CLI
        return this.executeAgent(message, options);
    }

    // 结束会话：调用 MCP finalize_session
    public async finalizeSession(): Promise<string> {
        try {
            const connected = await this.ensureMCPConnected();
            if (connected && this.mcpClient) {
                const res: any = await (this.mcpClient as any).callTool(
                    { name: 'finalize_session', arguments: {} },
                    CallToolResultSchema,
                    { timeout: 30000 }
                );
                let text = '';
                if (res && Array.isArray(res.content)) {
                    for (const item of res.content) {
                        if (item.type === 'text' && typeof item.text === 'string') {
                            text += item.text;
                        }
                    }
                }
                return text || 'Session finalized and cleaned up';
            }
        } catch (e) {
            return `Finalize session failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        return 'MCP 未就绪，无法结束会话';
    }
 }
