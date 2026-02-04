import * as vscode from 'vscode';
import { ApprovalRequest } from '../tools.d/utils';

export class ApprovalTreeItem extends vscode.TreeItem {
    constructor(
        public readonly request: ApprovalRequest
    ) {
        super(request.actionDescription, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.formatTime(request.timestamp);
        this.tooltip = this.buildTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = request.status === 'pending' ? 'pendingApproval' : 'resolvedApproval';
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString();
    }

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

    private getStatusText(): string {
        switch (this.request.status) {
            case 'pending': return '⏳ Pending';
            case 'approved': return '✅ Approved';
            case 'rejected': return '❌ Rejected';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.request.status) {
            case 'pending': return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
            case 'approved': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'rejected': return new vscode.ThemeIcon('x', new vscode.ThemeColor('charts.red'));
        }
    }
}