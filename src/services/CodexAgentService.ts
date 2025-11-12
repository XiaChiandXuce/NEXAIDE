import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export type CodexApprovalDecision = 'approved' | 'approved_for_session' | 'denied' | 'abort';

export interface CodexExecApprovalRequest {
    requestId: number | string;
    command: string[];
    cwd: string;
    reason?: string;
    risk?: any;
    parsedCmd?: any[];
}

export interface CodexAgentEvents {
    status: { text: string };
    error: { message: string };
    execApproval: CodexExecApprovalRequest;
    turnCompleted: { turnId: string; text: string; rawTurn: any };
}

interface PendingPromise {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

const DEFAULT_CLIENT_INFO = {
    name: 'nexaide-plugin',
    title: 'NEXAIDE',
    version: '0.1.0'
};

function isWindows(): boolean {
    return process.platform === 'win32';
}

function buildPlatformCodexPath(baseDir: string): string | undefined {
    if (isWindows()) {
        const winPath = path.join(baseDir, 'bin', 'windows-x86_64', 'codex.exe');
        return fs.existsSync(winPath) ? winPath : undefined;
    }
    if (process.platform === 'darwin') {
        const arch = process.arch === 'arm64' ? 'macos-arm64' : 'macos-x86_64';
        const darwinPath = path.join(baseDir, 'bin', arch, 'codex');
        return fs.existsSync(darwinPath) ? darwinPath : undefined;
    }
    const linuxPath = path.join(baseDir, 'bin', process.arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64', 'codex');
    return fs.existsSync(linuxPath) ? linuxPath : undefined;
}

function findBundledCodexBinary(): string | undefined {
    const home = process.env.USERPROFILE || process.env.HOME;
    if (!home) {
        return undefined;
    }
    const extensionsDir = path.join(home, '.vscode', 'extensions');
    try {
        const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory() && dirent.name.startsWith('openai.chatgpt-'))
            .sort((a, b) => b.name.localeCompare(a.name));
        for (const entry of entries) {
            const candidate = buildPlatformCodexPath(path.join(extensionsDir, entry.name));
            if (candidate) {
                return candidate;
            }
        }
    } catch {
        // ignore
    }
    return undefined;
}

function resolveCodexBinaryPath(customPath?: string): { path: string; requiresShell: boolean } {
    const candidates: string[] = [];
    if (customPath && customPath.trim().length > 0) {
        candidates.push(customPath.trim());
    }
    if (process.env.NEXAIDE_CODEX_PATH && process.env.NEXAIDE_CODEX_PATH.trim().length > 0) {
        candidates.push(process.env.NEXAIDE_CODEX_PATH.trim());
    }
    const bundled = findBundledCodexBinary();
    if (bundled) {
        candidates.push(bundled);
    }
    candidates.push('codex');

    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        const requiresShell = isWindows() && candidate.toLowerCase().endsWith('.cmd');
        if (candidate === 'codex') {
            return { path: candidate, requiresShell };
        }
        if (fs.existsSync(candidate)) {
            return { path: candidate, requiresShell };
        }
    }
    return { path: 'codex', requiresShell: false };
}

/**
 * Thin JSON-RPC client that talks to `codex app-server`.
 * Emits high-level events for approvals and turn updates so the VS Code UI can react.
 */
export class CodexAgentService extends EventEmitter {
    private process?: ChildProcessWithoutNullStreams;
    private reader?: readline.Interface;
    private requestSeq = 1;
    private pendingRequests = new Map<number, PendingPromise>();
    private pendingTurns = new Map<string, PendingPromise>();
    private bufferedTurnResults = new Map<string, { text: string; rawTurn: any }>();
    private codexPath: string;
    private initializePromise?: Promise<void>;
    private threadId?: string;
    private threadCwd?: string;
    private currentTurnId?: string;
    private disposed = false;
    private available = false;
    private requiresShell: boolean = false;

    constructor(private workspaceRoot: string, codexBinaryPath?: string) {
        super();
        const resolved = resolveCodexBinaryPath(codexBinaryPath);
        this.codexPath = resolved.path;
        this.requiresShell = resolved.requiresShell;
        console.log('[NEXAIDE][Codex] binary path =', this.codexPath, 'requiresShell =', this.requiresShell);
    }

    public isAvailable(): boolean {
        return this.available;
    }

    public async ensureReady(): Promise<boolean> {
        if (this.disposed) {
            return false;
        }
        if (!this.initializePromise) {
            this.initializePromise = this.startProcess();
        }
        try {
            await this.initializePromise;
            return this.available;
        } catch (error) {
            this.emit('error', { message: `Codex agent init failed: ${error instanceof Error ? error.message : String(error)}` });
            return false;
        }
    }

    private async startProcess(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            try {
                const cwd = this.workspaceRoot || process.cwd();
                this.process = spawn(this.codexPath, ['app-server'], {
                    cwd,
                    env: {
                        ...process.env,
                        NEXAIDE_AGENT: 'codex'
                    },
                    shell: this.requiresShell
                });
            } catch (error) {
                reject(error);
                return;
            }

            if (!this.process) {
                reject(new Error('Failed to spawn Codex process'));
                return;
            }

            this.process.on('error', (error) => {
                this.available = false;
                reject(error);
            });

            this.process.once('spawn', () => {
                resolve();
            });

            this.process.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                this.emit('status', { text: text.trim() });
            });

            this.process.on('exit', (code, signal) => {
                this.available = false;
                const message = `Codex process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
                this.emit('error', { message });
            });

            this.reader = readline.createInterface({
                input: this.process.stdout,
                crlfDelay: Infinity
            });

            this.reader.on('line', (line) => this.handleLine(line));
        });

        await this.sendRequest('initialize', { clientInfo: DEFAULT_CLIENT_INFO });
        this.available = true;
        this.emit('status', { text: 'Codex agent ready' });
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.pendingRequests.forEach(({ reject }) => reject(new Error('Codex agent disposed')));
        this.pendingRequests.clear();
        this.pendingTurns.forEach(({ reject }) => reject(new Error('Codex agent disposed')));
        this.pendingTurns.clear();
        this.reader?.removeAllListeners();
        this.reader?.close();
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
    }

    public async resetThread(): Promise<void> {
        this.threadId = undefined;
        this.threadCwd = undefined;
    }

    public async interruptCurrentTurn(): Promise<void> {
        if (!this.threadId || !this.currentTurnId) {
            return;
        }
        try {
            await this.sendRequest('turn/interrupt', {
                threadId: this.threadId,
                turnId: this.currentTurnId
            });
        } catch (error) {
            this.emit('error', { message: `Failed to interrupt turn: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    public async sendMessage(message: string, workingDirectory: string): Promise<string> {
        const ready = await this.ensureReady();
        if (!ready) {
            throw new Error('Codex agent unavailable');
        }

        if (!this.threadId || this.threadCwd !== workingDirectory) {
            await this.startThread(workingDirectory);
        }

        const turnResponse = await this.sendRequest('turn/start', {
            threadId: this.threadId,
            input: [{ type: 'text', text: message }]
        });
        const turnId: string = turnResponse?.turn?.id;
        if (!turnId) {
            throw new Error('Codex turn did not provide an id');
        }

        this.currentTurnId = turnId;

        const buffered = this.bufferedTurnResults.get(turnId);
        if (buffered) {
            this.bufferedTurnResults.delete(turnId);
            return buffered.text;
        }

        return new Promise<string>((resolve, reject) => {
            this.pendingTurns.set(turnId, { resolve, reject });
        });
    }

    public async respondToExecApproval(requestId: number | string, decision: CodexApprovalDecision): Promise<void> {
        await this.writeMessage({
            id: requestId,
            result: {
                decision: decision === 'approved_for_session' ? 'approved_for_session' :
                    decision === 'denied' ? 'denied' :
                        decision === 'abort' ? 'abort' : 'approved'
            }
        });
    }

    private async startThread(workingDirectory: string): Promise<void> {
        const params = {
            model: process.env.NEXAIDE_CODEX_MODEL || undefined,
            model_provider: undefined,
            cwd: workingDirectory,
            approval_policy: process.env.NEXAIDE_CODEX_APPROVAL || 'on-request',
            sandbox: process.env.NEXAIDE_CODEX_SANDBOX || 'workspaceWrite',
            config: undefined,
            base_instructions: undefined,
            developer_instructions: undefined
        };
        const response = await this.sendRequest('thread/start', params);
        const threadId: string = response?.thread?.id;
        if (!threadId) {
            throw new Error('Codex thread creation failed');
        }
        this.threadId = threadId;
        this.threadCwd = workingDirectory;
    }

    private handleLine(line: string) {
        if (!line || !line.trim()) {
            return;
        }
        let parsed: any;
        try {
            parsed = JSON.parse(line);
        } catch (error) {
            this.emit('error', { message: `Codex JSON parse error: ${line}` });
            return;
        }

        if (parsed.method && typeof parsed.id !== 'undefined' && parsed.params) {
            this.handleServerRequest(parsed);
        } else if (parsed.method && !parsed.id) {
            this.handleNotification(parsed);
        } else if (typeof parsed.id !== 'undefined' && parsed.result) {
            this.handleResponse(parsed);
        } else if (typeof parsed.id !== 'undefined' && parsed.error) {
            const pending = this.pendingRequests.get(parsed.id);
            if (pending) {
                this.pendingRequests.delete(parsed.id);
                pending.reject(new Error(parsed.error?.message || 'Codex request failed'));
            }
        }
    }

    private handleResponse(message: any) {
        const pending = this.pendingRequests.get(message.id);
        if (!pending) {
            return;
        }
        this.pendingRequests.delete(message.id);
        pending.resolve(message.result);
    }

    private handleServerRequest(message: any) {
        switch (message.method) {
            case 'execCommandApproval':
                this.emit('execApproval', {
                    requestId: message.id,
                    ...message.params
                } as CodexExecApprovalRequest);
                break;
            case 'applyPatchApproval':
                this.respondToExecApproval(message.id, 'approved').catch(() => undefined);
                break;
            default:
                this.respondToExecApproval(message.id, 'approved').catch(() => undefined);
                break;
        }
    }

    private handleNotification(message: any) {
        switch (message.method) {
            case 'turn/completed':
                this.processTurnCompleted(message.params);
                break;
            case 'turn/started':
                this.currentTurnId = message.params?.turn?.id;
                break;
            case 'item/commandExecution/outputDelta':
                this.emit('status', { text: message.params?.delta ?? '' });
                break;
            case 'item/agentMessage/delta':
                this.emit('status', { text: message.params?.delta ?? '' });
                break;
            default:
                break;
        }
    }

    private processTurnCompleted(notification: any) {
        const turnId: string | undefined = notification?.turn?.id;
        if (!turnId) {
            return;
        }
        const agentMessages: string[] = [];
        const items = notification.turn?.items ?? [];

        for (const item of items) {
            if (item?.type === 'agent_message' || item?.type === 'agentMessage') {
                if (typeof item.text === 'string') {
                    agentMessages.push(item.text);
                }
            }
        }

        const text = agentMessages.length > 0 ? agentMessages[agentMessages.length - 1] : '(no response)';
        const pending = this.pendingTurns.get(turnId);
        if (pending) {
            this.pendingTurns.delete(turnId);
            pending.resolve(text);
        } else {
            this.bufferedTurnResults.set(turnId, { text, rawTurn: notification.turn });
        }
        this.emit('turnCompleted', { turnId, text, rawTurn: notification.turn });
    }

    private async sendRequest(method: string, params?: any): Promise<any> {
        const id = this.requestSeq++;
        const payload: any = {
            id,
            method,
            params
        };
        await this.writeMessage(payload);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });
    }

    private async writeMessage(payload: any): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin.writable) {
                reject(new Error('Codex process stdin not writable'));
                return;
            }
            const json = JSON.stringify(payload);
            this.process.stdin.write(json + '\n', (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    public static async detectAvailability(workspaceRoot: string): Promise<boolean> {
        const resolved = resolveCodexBinaryPath();
        const binary = resolved.path;
        const needsShell = resolved.requiresShell;
        try {
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(binary, ['--version'], {
                    cwd: workspaceRoot || process.cwd(),
                    env: process.env,
                    shell: needsShell
                });
                proc.on('error', reject);
                proc.on('exit', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`codex --version exited with code ${code}`));
                    }
                });
            });
            return true;
        } catch (error) {
            console.warn('[NEXAIDE][Codex] detectAvailability failed', {
                binary,
                needsShell,
                error: error instanceof Error ? error.message : error
            });
            return false;
        }
    }
}
