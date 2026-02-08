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
            `\n_Please check the Mutsumi sidebar to approve or reject this request._\n`
        );
    }

    // 显示非模态通知（不带按钮）
    vscode.window.showInformationMessage(
        `Mutsumi: Agent requests permission to ${actionDescription}. Check sidebar to respond.`
    );

    // 添加到授权管理器并等待用户响应
    const approved = await approvalManager.addRequest(actionDescription, targetUri, details);

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