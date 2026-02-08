import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
import { ToolContext } from './interface';
import { v4 as uuidv4 } from 'uuid';

// ====== Approval Request System ======

export interface ApprovalRequest {
    id: string;
    actionDescription: string;
    targetUri: string;
    details?: string;
    timestamp: Date;
    status: 'pending' | 'approved' | 'rejected';
    resolve: (approved: boolean) => void;
}

class ApprovalRequestManager {
    private static instance: ApprovalRequestManager;
    private requests: Map<string, ApprovalRequest> = new Map();
    private _onDidChangeRequests = new vscode.EventEmitter<void>();
    public readonly onDidChangeRequests = this._onDidChangeRequests.event;

    private constructor() {}

    public static getInstance(): ApprovalRequestManager {
        if (!ApprovalRequestManager.instance) {
            ApprovalRequestManager.instance = new ApprovalRequestManager();
        }
        return ApprovalRequestManager.instance;
    }

    public addRequest(actionDescription: string, targetUri: string, details?: string): Promise<boolean> {
        return new Promise((resolve) => {
            const id = uuidv4();
            const request: ApprovalRequest = {
                id,
                actionDescription,
                targetUri,
                details,
                timestamp: new Date(),
                status: 'pending',
                resolve: (approved: boolean) => {
                    request.status = approved ? 'approved' : 'rejected';
                    // 短暂延迟后移除，让用户看到状态变化
                    setTimeout(() => {
                        this.requests.delete(id);
                        this._onDidChangeRequests.fire();
                    }, 1000);
                    resolve(approved);
                }
            };
            this.requests.set(id, request);
            this._onDidChangeRequests.fire();
        });
    }

    /**
     * Create a request and return both the ID and the promise.
     * This allows the caller to set up additional handling (e.g., notification buttons)
     * before awaiting the result.
     */
    public createRequest(actionDescription: string, targetUri: string, details?: string): { id: string; promise: Promise<boolean> } {
        let resolveFn: (approved: boolean) => void;
        const promise = new Promise<boolean>((resolve) => {
            resolveFn = resolve;
        });

        const id = uuidv4();
        const request: ApprovalRequest = {
            id,
            actionDescription,
            targetUri,
            details,
            timestamp: new Date(),
            status: 'pending',
            resolve: (approved: boolean) => {
                request.status = approved ? 'approved' : 'rejected';
                // 短暂延迟后移除，让用户看到状态变化
                setTimeout(() => {
                    this.requests.delete(id);
                    this._onDidChangeRequests.fire();
                }, 1000);
                resolveFn(approved);
            }
        };
        this.requests.set(id, request);
        this._onDidChangeRequests.fire();

        return { id, promise };
    }

    public approveRequest(id: string): void {
        const request = this.requests.get(id);
        if (request && request.status === 'pending') {
            request.resolve(true);
        }
    }

    public rejectRequest(id: string): void {
        const request = this.requests.get(id);
        if (request && request.status === 'pending') {
            request.resolve(false);
        }
    }

    public getPendingRequests(): ApprovalRequest[] {
        return Array.from(this.requests.values()).filter(r => r.status === 'pending');
    }

    public getAllRequests(): ApprovalRequest[] {
        return Array.from(this.requests.values());
    }

    public getRequest(id: string): ApprovalRequest | undefined {
        return this.requests.get(id);
    }
}

export const approvalManager = ApprovalRequestManager.getInstance();

// ====== Edit File Session Management ======

export interface EditFileSession {
    id: string;
    filePath: string;
    originalUri: vscode.Uri;
    tempUri: vscode.Uri;
    toolName: string;
    timestamp: Date;
    status: 'pending' | 'partially_accepted' | 'resolved';
}

class EditFileSessionManager {
    private static instance: EditFileSessionManager;
    private sessions: Map<string, EditFileSession> = new Map();
    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private constructor() {}

    public static getInstance(): EditFileSessionManager {
        if (!EditFileSessionManager.instance) {
            EditFileSessionManager.instance = new EditFileSessionManager();
        }
        return EditFileSessionManager.instance;
    }

    public addSession(session: Omit<EditFileSession, 'id' | 'timestamp' | 'status'>): string {
        const id = uuidv4();
        const fullSession: EditFileSession = {
            ...session,
            id,
            timestamp: new Date(),
            status: 'pending'
        };
        this.sessions.set(id, fullSession);
        this._onDidChangeSessions.fire();
        return id;
    }

    public markPartiallyAccepted(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.status = 'partially_accepted';
            this._onDidChangeSessions.fire();
        }
    }

    public resolveSession(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.status = 'resolved';
            // 短暂延迟后移除，让用户看到状态变化
            setTimeout(() => {
                this.sessions.delete(id);
                this._onDidChangeSessions.fire();
            }, 1000);
        }
    }

    public getSession(id: string): EditFileSession | undefined {
        return this.sessions.get(id);
    }

    public getActiveSessions(): EditFileSession[] {
        return Array.from(this.sessions.values())
            .filter(s => s.status !== 'resolved')
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public getAllSessions(): EditFileSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public removeSession(id: string): void {
        this.sessions.delete(id);
        this._onDidChangeSessions.fire();
    }
}

export const editFileSessionManager = EditFileSessionManager.getInstance();

/**
 * Request user approval for a potentially dangerous operation.
 * Shows a notification and adds a request to the approval sidebar.
 * @param actionDescription Short description of the action (e.g., "Create Directory")
 * @param targetUri The target URI or path
 * @param context Tool context for output
 * @param details Optional additional details
 * @returns Promise that resolves to true if approved, false if rejected
 */
export async function requestApproval(
    actionDescription: string,
    targetUri: string,
    context: ToolContext,
    details?: string
): Promise<boolean> {
    // 在 Notebook 中显示等待信息
    if (context.appendOutput) {
        await context.appendOutput(
            `\n\n**⚠️ Approval Required**\n\n` +
            `Agent wants to: **${actionDescription}**\n` +
            `Target: \`${targetUri}\`\n` +
            (details ? `Details: ${details}\n` : '') +
            `\n_Please check the Mutsumi sidebar or notification to approve or reject this request._\n`
        );
    }

    // 创建请求并获取 ID 和 Promise
    const { id, promise: requestPromise } = approvalManager.createRequest(actionDescription, targetUri, details);

    // 显示带有快速批准/拒绝按钮的通知
    vscode.window.showInformationMessage(
        `Mutsumi: Agent requests permission to ${actionDescription}`,
        '✅ Approve',
        '❌ Reject'
    ).then(selection => {
        if (selection === '✅ Approve') {
            approvalManager.approveRequest(id);
        } else if (selection === '❌ Reject') {
            approvalManager.rejectRequest(id);
        }
        // 如果用户关闭通知而不点击按钮，请求仍保留在侧边栏等待处理
    });

    // 等待用户响应（通过通知按钮或侧边栏）
    const approved = await requestPromise;

    // 更新 Notebook 输出
    if (context.appendOutput) {
        await context.appendOutput(approved ? `**✅ Approved**\n\n` : `**❌ Rejected**\n\n`);
    }

    return approved;
}

export function resolveUri(input: string): vscode.Uri {
    try {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
            return vscode.Uri.parse(input);
        }
        if (input.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(input)) {
            return vscode.Uri.file(input);
        }
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const rootPath = root.path.endsWith('/') ? root.path : root.path + '/';
            const childPath = input.startsWith('/') ? input.substring(1) : input;
            return root.with({ path: rootPath + childPath });
        }
        return vscode.Uri.file(input);
    } catch (e) {
        throw new Error(`Failed to resolve URI from input: ${input}`);
    }
}

export function checkAccess(targetUri: vscode.Uri, allowedUris: string[]): boolean {
    // Normalize target path for comparison (handling OS specifics and case sensitivity)
    const targetPath = path.normalize(targetUri.fsPath).toLowerCase();

    for (const allowed of allowedUris) {
        if (allowed === '/') return true;
        
        let allowedUri: vscode.Uri;
        let allowedPath: string;
        try {
            // If it looks like a URI scheme, parse it
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(allowed)) {
                allowedUri = vscode.Uri.parse(allowed);
            } else if (allowed.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(allowed)) {
                // Absolute path
                allowedUri = vscode.Uri.file(allowed);
            } else {
                // Relative path - resolve it the same way as targetUri
                allowedUri = resolveUri(allowed);
            }
            allowedPath = allowedUri.fsPath;
        } catch {
            // Fallback: treat as-is
            allowedPath = allowed;
        }

        const normalizedAllowed = path.normalize(allowedPath).toLowerCase();

        // Exact match
        if (targetPath === normalizedAllowed) return true;

        // Directory match: ensure allowedPath ends with separator
        const separator = path.sep;
        const allowedDir = normalizedAllowed.endsWith(separator) ? normalizedAllowed : normalizedAllowed + separator;
        
        if (targetPath.startsWith(allowedDir)) return true;
    }
    return false;
}

export function getUriKey(uri: vscode.Uri): string {
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

const COMMON_IGNORED = new Set(['node_modules', '.git', '.vscode', 'dist', 'out', 'build', '__pycache__', 'coverage']);

export function isCommonIgnored(name: string): boolean {
    return name.startsWith('.') || COMMON_IGNORED.has(name);
}