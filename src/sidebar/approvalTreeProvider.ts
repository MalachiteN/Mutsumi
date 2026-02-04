import * as vscode from 'vscode';
import { ApprovalTreeItem } from './approvalTreeItem';
import { approvalManager, ApprovalRequest } from '../tools.d/utils';

export class ApprovalTreeDataProvider implements vscode.TreeDataProvider<ApprovalTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ApprovalTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
        // 监听授权请求变化
        approvalManager.onDidChangeRequests(() => {
            this.refresh();
        });
    }

    getTreeItem(element: ApprovalTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ApprovalTreeItem): Thenable<ApprovalTreeItem[]> {
        if (element) {
            // 没有子节点
            return Promise.resolve([]);
        }

        // 返回所有请求，pending 的排在前面
        const requests = approvalManager.getAllRequests();
        requests.sort((a, b) => {
            // pending 优先
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            // 同状态按时间倒序
            return b.timestamp.getTime() - a.timestamp.getTime();
        });

        return Promise.resolve(requests.map(r => new ApprovalTreeItem(r)));
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
}