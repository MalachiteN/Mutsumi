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

export interface ApprovalRequestHandlers {
    onApprove: () => Promise<void>;
    onReject: () => Promise<void>;
    customAction?: {
        label: string;
        handler: () => Promise<void>;
    };
}

export interface ApprovalRequest {
    id: string;
    actionDescription: string;
    targetUri: string;
    details?: string;
    timestamp: Date;
    status: 'pending' | 'approved' | 'rejected';
    autoApproved: boolean;
    
    // Handlers
    onApprove: () => Promise<void>;
    onReject: () => Promise<void>;
    customAction?: {
        label: string;
        handler: () => Promise<void>;
    };
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
     * Create a generic request with custom handlers.
     */
    public createRequest(
        actionDescription: string, 
        targetUri: string, 
        handlers: ApprovalRequestHandlers,
        details?: string, 
        autoApproved: boolean = false
    ): string {
        const id = uuidv4();
        
        const request: ApprovalRequest = {
            id,
            actionDescription,
            targetUri,
            details,
            timestamp: new Date(),
            status: autoApproved ? 'approved' : 'pending',
            autoApproved,
            onApprove: async () => {
                if (request.status !== 'pending' && !request.autoApproved) return;
                try {
                    await handlers.onApprove();
                } finally {
                    this.finalizeRequest(id, 'approved');
                }
            },
            onReject: async () => {
                if (request.status !== 'pending') return;
                try {
                    await handlers.onReject();
                } finally {
                    this.finalizeRequest(id, 'rejected');
                }
            },
            customAction: handlers.customAction
        };

        this.requests.set(id, request);
        this._onDidChangeRequests.fire();

        if (autoApproved) {
            request.onApprove();
        }

        return id;
    }

    private finalizeRequest(id: string, status: 'approved' | 'rejected') {
        const req = this.requests.get(id);
        if (req) {
            req.status = status;
            this._onDidChangeRequests.fire();
            // Remove after delay
            setTimeout(() => {
                this.requests.delete(id);
                this._onDidChangeRequests.fire();
            }, 1000);
        }
    }

    /**
     * Create a standard request and return both the ID and the promise.
     * Compatible with old createRequest signature but used internally or for simple cases.
     */
    public createStandardRequest(
        actionDescription: string, 
        targetUri: string, 
        details?: string, 
        autoApproved: boolean = false
    ): { id: string; promise: Promise<boolean> } { // DO NOT PLACE A COMMA BETWEEN THE FUNCTION BODY AND THE JSON RETURN TYPE! OR IT WILL CAUSE "应为 "{" 或 ";"。意外的标记。应为构造函数、方法、访问器或属性。"
        let resolveFn: (approved: boolean) => void;
        const promise = new Promise<boolean>((resolve) => {
            resolveFn = resolve;
        });

        const id = this.createRequest(
            actionDescription,
            targetUri,
            {
                onApprove: async () => resolveFn(true),
                onReject: async () => resolveFn(false)
            },
            details,
            autoApproved
        );

        return { id, promise };
    }

    // Deprecated wrapper for backward compatibility if any direct calls exist
    public addRequest(actionDescription: string, targetUri: string, details?: string, autoApproved: boolean = false): Promise<boolean> {
        const { promise } = this.createStandardRequest(actionDescription, targetUri, details, autoApproved);
        return promise;
    }

    public async approveRequest(id: string): Promise<void> {
        const request = this.requests.get(id);
        if (request && request.status === 'pending') {
            await request.onApprove();
        }
    }

    public async rejectRequest(id: string): Promise<void> {
        const request = this.requests.get(id);
        if (request && request.status === 'pending') {
            await request.onReject();
        }
    }

    public async handleCustomAction(id: string): Promise<void> {
        const request = this.requests.get(id);
        if (request && request.status === 'pending' && request.customAction) {
            await request.customAction.handler();
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
        // Auto-approved: show notification and create a record for sidebar history
        const modeText = isInRuleParsingMode() ? ' (Rule Parsing)' : '';
        vscode.window.showInformationMessage(
            `⚡ Auto Approved${modeText}: ${actionDescription} - ${targetUri}`
        );
        approvalManager.createStandardRequest(actionDescription, targetUri, details, true);
        return true;
    }

    // 创建标准请求
    const { id, promise: requestPromise } = approvalManager.createStandardRequest(actionDescription, targetUri, details, false);

    // 显示带有快速批准/拒绝按钮的通知
    vscode.window.showInformationMessage(
        `Mutsumi: Agent requests permission to ${actionDescription}`,
        'Approve',
        'Reject'
    ).then(selection => {
        if (selection === 'Approve') {
            approvalManager.approveRequest(id);
        } else if (selection === 'Reject') {
            approvalManager.rejectRequest(id);
        }
        // 如果用户关闭通知而不点击按钮，请求仍保留在侧边栏等待处理
    });

    // 等待用户响应（通过通知按钮或侧边栏）
    const approved = await requestPromise;

    return approved;
}
