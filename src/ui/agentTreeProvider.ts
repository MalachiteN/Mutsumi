import * as vscode from 'vscode';
import { AgentTreeItem, AgentNodeData } from './agentTreeItem';
import { AgentOrchestrator } from '../agentOrchestrator';

export class AgentTreeDataProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private rootItems: AgentTreeItem[] = [];

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.rootItems);
        }
        return Promise.resolve(element.children);
    }

    public async refresh(): Promise<void> {
        this.rootItems = [];
        const orch = AgentOrchestrator.getInstance();
        const allAgents = orch.getAgentTreeNodes(); // 获取扁平列表

        const nodeMap = new Map<string, AgentTreeItem>();
        
        // 1. 创建所有 Item
        allAgents.forEach(info => {
            // 计算状态决定是否可折叠：如果有子节点挂在这个 UUID 下，它应该是 Collapsed
            // 但这里我们先统一设为 None，随后在构建层级时更新为 Collapsed
            const item = new AgentTreeItem(
                {
                    uuid: info.uuid,
                    name: info.name,
                    status: orch.computeStatus(info),
                    parentId: info.parentId,
                    fileUri: info.fileUri
                },
                vscode.TreeItemCollapsibleState.None 
            );
            nodeMap.set(info.uuid, item);
        });

        // 2. 构建层级关系
        allAgents.forEach(info => {
            const item = nodeMap.get(info.uuid)!;
            if (info.parentId && nodeMap.has(info.parentId)) {
                const parent = nodeMap.get(info.parentId)!;
                parent.children.push(item);
                // 只有当父节点有子节点时，才设为可折叠
                parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            } else {
                // 没有 Parent 或 Parent 不在当前显示列表中（比如Parent被关闭且Hidden了）
                // 则作为根节点
                this.rootItems.push(item);
            }
        });

        this._onDidChangeTreeData.fire(null);
    }

    public getAgentItem(uuid: string): AgentTreeItem | undefined {
        // Helper if needed, implies keeping a map
        return undefined; 
    }
}