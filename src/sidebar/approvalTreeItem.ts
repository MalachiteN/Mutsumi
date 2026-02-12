import * as vscode from 'vscode';
import { ApprovalRequest, EditFileSession } from '../tools.d/utils';

/**
 * @description Approval request tree node item for displaying tool call approval requests in the sidebar
 * @class ApprovalTreeItem
 * @extends {vscode.TreeItem}
 * @example
 * const request: ApprovalRequest = { id: '123', actionDescription: 'Delete file', ... };
 * const item = new ApprovalTreeItem(request);
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
         * Sets contextValue based on request status to control context menu options
         * pendingApproval: show approve/reject buttons
         * resolvedApproval: only show view options
         */
        this.contextValue = request.status === 'pending' ? 'pendingApproval' : 'resolvedApproval';
    }

    /**
     * @description Formats date to localized time string
     * @private
     * @param {Date} date - Date to format
     * @returns {string} Localized time string
     * @example
     * const timeStr = this.formatTime(new Date()); // Returns "10:30:45"
     */
    private formatTime(date: Date): string {
        return date.toLocaleTimeString();
    }

    /**
     * @description Builds Markdown tooltip displayed on mouse hover
     * @private
     * @returns {vscode.MarkdownString} Markdown string containing request details
     * @example
     * Displays: action description, target URI, details, timestamp, status
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${this.request.actionDescription}**\n\n`);
        md.appendMarkdown(`📁 Target: \`${this.request.targetUri}\`\n\n`);
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
     * @returns {string} Status description with emoji
     * @example
     * const text = this.getStatusText(); // Returns "⏳ Pending" | "✅ Approved" | "❌ Rejected"
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
     * @returns {vscode.ThemeIcon} Status icon with theme color
     * @example
     * const icon = this.getIcon(); // pending=yellow question mark, approved=green check, rejected=red cross
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
 * @description Edit file session tree node item for displaying active edit sessions in the sidebar
 * Allows users to reopen the diff editor if it was accidentally closed
 * @class EditFileTreeItem
 * @extends {vscode.TreeItem}
 * @example
 * const session: EditFileSession = { id: '123', filePath: '/path/to/file.ts', ... };
 * const item = new EditFileTreeItem(session);
 */
export class EditFileTreeItem extends vscode.TreeItem {
    /**
     * @description Creates a new edit file session tree node item
     * @param {EditFileSession} session - Edit file session data object
     */
    constructor(
        public readonly session: EditFileSession
    ) {
        super(session.filePath, vscode.TreeItemCollapsibleState.None);

        this.description = this.formatTime(session.timestamp);
        this.tooltip = this.buildTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = 'editFilePending';

        // 点击命令：重新打开 Diff Editor
        this.command = {
            command: 'mutsumi.reopenEditDiff',
            title: 'Reopen Diff Editor',
            arguments: [session.id]
        };
    }

    /**
     * @description Formats date to localized time string
     * @private
     * @param {Date} date - Date to format
     * @returns {string} Localized time string
     */
    private formatTime(date: Date): string {
        return date.toLocaleTimeString();
    }

    /**
     * @description Builds Markdown tooltip displayed on mouse hover
     * @private
     * @returns {vscode.MarkdownString} Markdown string containing session details
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Edit File Session**\n\n`);
        md.appendMarkdown(`📁 File: \`${this.session.filePath}\`\n\n`);
        md.appendMarkdown(`🔧 Tool: ${this.session.toolName}\n\n`);
        md.appendMarkdown(`🕐 Started: ${this.session.timestamp.toLocaleString()}\n\n`);
        md.appendMarkdown(`Status: ${this.getStatusText()}\n\n`);
        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(`💡 **Click to reopen the diff editor**`);
        return md;
    }

    /**
     * @description Gets corresponding status text based on session status
     * @private
     * @returns {string} Status description with emoji
     */
    private getStatusText(): string {
        switch (this.session.status) {
            case 'pending': return '⏳ Waiting for review (Diff view available)';
            case 'resolved': return '✅ Resolved';
            default: return '⏳ Unknown';
        }
    }

    /**
     * @description Gets corresponding icon based on session status
     * @private
     * @returns {vscode.ThemeIcon} Status icon with theme color
     */
    private getIcon(): vscode.ThemeIcon {
        switch (this.session.status) {
            case 'pending': return new vscode.ThemeIcon('git-compare', new vscode.ThemeColor('charts.yellow'));
            case 'resolved': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            default: return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
        }
    }
}
