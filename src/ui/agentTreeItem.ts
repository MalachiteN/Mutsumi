import * as vscode from 'vscode';
import { AgentRuntimeStatus } from '../types';

export interface AgentNodeData {
    uuid: string;
    name: string;
    status: AgentRuntimeStatus;
    parentId?: string | null;
    fileUri: string;
}

export class AgentTreeItem extends vscode.TreeItem {
    public children: AgentTreeItem[] = [];

    constructor(
        public readonly agentData: AgentNodeData,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(agentData.name, collapsibleState);
        
        this.description = this.getStatusLabel(agentData.status);
        this.iconPath = this.getIconPath(agentData.status);
        
        // Context Value 用于菜单控制
        // 区分是 Parent 还是 Child，也许菜单选项不同
        this.contextValue = agentData.parentId ? 'childAgent' : 'rootAgent';

        // 关键：不再绑定点击命令，从而恢复默认的折叠/展开行为
        // 若需自定义点击行为 (如打开文件)，通常建议不要覆盖默认点击，
        // 除非它是叶子节点且一定是打开文件。
        // 按照需求：左键点击任何 Agent 都是切换折叠状态。
        this.command = undefined; 
    }

    private getStatusLabel(status: AgentRuntimeStatus): string {
        switch (status) {
            case 'running': return 'Running';
            case 'pending': return 'Pending';
            case 'finished': return 'Finished';
            case 'standby': return 'Standby';
            default: return '';
        }
    }

    private getIconPath(status: AgentRuntimeStatus): vscode.ThemeIcon {
        switch (status) {
            case 'running': return new vscode.ThemeIcon('sync~spin');
            case 'finished': return new vscode.ThemeIcon('check');
            case 'pending': return new vscode.ThemeIcon('clock');
            case 'standby': return new vscode.ThemeIcon('circle-outline');
            default: return new vscode.ThemeIcon('question');
        }
    }
}