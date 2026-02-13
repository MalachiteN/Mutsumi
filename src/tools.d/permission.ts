import * as vscode from 'vscode';
import { ToolContext } from './interface';
import { v4 as uuidv4 } from 'uuid';

// ====== Auto Approval Configuration ======

const AUTO_APPROVE_CONFIG_KEY = 'mutsumi.autoApproveEnabled';

/**
 * Check if auto-approve mode is enabled globally.
 */
export function isAutoApproveEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(AUTO_APPROVE_CONFIG_KEY, false);
}

/**
 * Set auto-approve mode globally.
 */
export async function setAutoApproveEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration().update(AUTO_APPROVE_CONFIG_KEY, enabled, true);
}

/**
 * Toggle auto-approve mode.
 */
export async function toggleAutoApprove(): Promise<boolean> {
    const current = isAutoApproveEnabled();
    await setAutoApproveEnabled(!current);
    return !current;
}

// ====== Rule Parsing Manager (封装规则解析状态) ======

class RuleParsingManager {
    private static instance: RuleParsingManager;
    private ruleParsingDepth = 0;

    private constructor() {}

    public static getInstance(): RuleParsingManager {
        if (!RuleParsingManager.instance) {
            RuleParsingManager.instance = new RuleParsingManager();
        }
        return RuleParsingManager.instance;
    }

    public enter(): void {
        this.ruleParsingDepth++;
    }

    public exit(): void {
        if (this.ruleParsingDepth > 0) {
            this.ruleParsingDepth--;
        }
    }

    public isActive(): boolean {
        return this.ruleParsingDepth > 0;
    }

    public async with<T>(fn: () => Promise<T>): Promise<T> {
        this.enter();
        try {
            return await fn();
        } finally {
            this.exit();
        }
    }
}

// 保持原有的规则解析便捷函数导出（向后兼容）

/**
 * Enter rule parsing mode - tool calls during rule parsing are auto-approved.
 */
export function enterRuleParsingMode(): void {
    RuleParsingManager.getInstance().enter();
}

/**
 * Exit rule parsing mode.
 */
export function exitRuleParsingMode(): void {
    RuleParsingManager.getInstance().exit();
}

/**
 * Check if currently in rule parsing mode.
 */
export function isInRuleParsingMode(): boolean {
    return RuleParsingManager.getInstance().isActive();
}

/**
 * Execute a function within rule parsing mode context.
 * Tool calls made during the execution will be auto-approved.
 */
export async function withRuleParsingMode<T>(fn: () => Promise<T>): Promise<T> {
    return RuleParsingManager.getInstance().with(fn);
}

// ====== Approval Request System ======

export interface ApprovalRequest {
    id: string;
    actionDescription: string;
    targetUri: string;
    details?: string;
    timestamp: Date;
    status: 'pending' | 'approved' | 'rejected';
    autoApproved: boolean;
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

    /**
     * Create a request and return both the ID and the promise.
     * This allows the caller to set up additional handling (e.g., notification buttons)
     * before awaiting the result.
     */
    public createRequest(actionDescription: string, targetUri: string, details?: string, autoApproved: boolean = false): { id: string; promise: Promise<boolean> } {
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
            status: autoApproved ? 'approved' : 'pending',
            autoApproved,
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

        // If auto-approved, resolve immediately
        if (autoApproved) {
            request.resolve(true);
        }

        return { id, promise };
    }

    /**
     * Add a request and return only the promise.
     * This is a convenience wrapper around createRequest.
     */
    public addRequest(actionDescription: string, targetUri: string, details?: string, autoApproved: boolean = false): Promise<boolean> {
        const { promise } = this.createRequest(actionDescription, targetUri, details, autoApproved);
        return promise;
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
 * Check if a request should be auto-approved based on current mode.
 */
function shouldAutoApprove(): boolean {
    // Auto-approve if global auto-approve mode is enabled
    if (isAutoApproveEnabled()) {
        return true;
    }
    // Auto-approve if in rule parsing mode
    if (isInRuleParsingMode()) {
        return true;
    }
    return false;
}

/**
 * Request user approval for a potentially dangerous operation.
 * Shows a notification and adds a request to the approval sidebar.
 * 
 * If auto-approve mode is enabled or in rule parsing mode, automatically returns true.
 * 
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
    // Check if should auto-approve
    const autoApprove = shouldAutoApprove();
    
    if (autoApprove) {
        // Log auto-approval in Notebook output
        if (context.appendOutput) {
            await context.appendOutput(
                `\n\n**⚡ Auto Approved**${isInRuleParsingMode() ? ' (Rule Parsing)' : ''}\n\n` +
                `Action: **${actionDescription}**\n` +
                `Target: \`${targetUri}\`\n` +
                (details ? `Details: ${details}\n` : '')
            );
        }
        
        // Create a request record for history (but auto-approved)
        approvalManager.createRequest(actionDescription, targetUri, details, true);
        return true;
    }

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
    const { id, promise: requestPromise } = approvalManager.createRequest(actionDescription, targetUri, details, false);

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
