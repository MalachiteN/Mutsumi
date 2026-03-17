import * as vscode from 'vscode';
import { ApprovalRequest, approvalManager } from '../tools.d/permission';

/**
 * @description Approval request tree node item for displaying tool call approval requests in the sidebar
 * @class ApprovalTreeItem
 * @extends {vscode.TreeItem}
 */
export class ApprovalTreeItem extends vscode.TreeItem {
    /**
     * @description Creates a new approval request tree node item
     * @param {ApprovalRequest} request - Approval request data object
     */
    constructor(
        public readonly request: ApprovalRequest
    ) {
        super(request.actionDescription, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.formatTime(request.timestamp);
        this.tooltip = this.buildTooltip();
        this.iconPath = this.getIcon();
        
        /**
         * Sets contextValue based on request status and custom action capability.
         * pendingApproval: show approve/reject buttons
         * pendingApprovalWithCustom: show approve/reject AND custom action button
         * resolvedApproval: only show view options
         */
        if (request.status === 'pending') {
            this.contextValue = request.customAction ? 'pendingApprovalWithCustom' : 'pendingApproval';
        } else {
            this.contextValue = 'resolvedApproval';
        }
    }

    /**
     * @description Formats date to localized time string
     * @private
     */
    private formatTime(date: Date): string {
        return date.toLocaleTimeString();
    }

    /**
     * @description Builds Markdown tooltip displayed on mouse hover
     * @private
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.request.actionDescription}**\n\n`);
        md.appendMarkdown(`📁 Target: \`${this.request.targetUri}\`\n\n`);
        
        if (this.request.customAction) {
             md.appendMarkdown(`🔍 **Custom Action Available**: ${this.request.customAction.label}\n\n`);
        }

        if (this.request.details) {
            md.appendMarkdown(`📝 Details:\n\`\`\`\n${this.request.details}\n\`\`\`\n\n`);
        }
        md.appendMarkdown(`🕐 Time: ${this.request.timestamp.toLocaleString()}\n\n`);
        md.appendMarkdown(`Status: ${this.getStatusText()}`);
        return md;
    }

    /**
     * @description Gets corresponding status text based on request status
     * @private
     */
    private getStatusText(): string {
        switch (this.request.status) {
            case 'pending': return '⏳ Pending';
            case 'approved': return '✅ Approved';
            case 'rejected': return '❌ Rejected';
        }
    }

    /**
     * @description Gets corresponding icon based on request status
     * @private
     */
    private getIcon(): vscode.ThemeIcon {
        switch (this.request.status) {
            case 'pending': return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
            case 'approved': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'rejected': return new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
        }
    }
}

/**
 * @description Registers approval-related commands to the VSCode extension context
 * @param {vscode.ExtensionContext} context - Extension context for registering subscriptions
 */
export function registerApprovalCommands(context: vscode.ExtensionContext): void {
    // Register approve request command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.approveRequest', (item: any) => {
            if (item && item.request && item.request.id) {
                approvalManager.approveRequest(item.request.id);
            }
        })
    );

    // Register reject request command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.rejectRequest', (item: any) => {
            if (item && item.request && item.request.id) {
                approvalManager.rejectRequest(item.request.id);
            }
        })
    );

    // Register custom request action command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.customRequestAction', (item: any) => {
            if (item && item.request && item.request.id) {
                approvalManager.handleCustomAction(item.request.id);
            }
        })
    );
}
