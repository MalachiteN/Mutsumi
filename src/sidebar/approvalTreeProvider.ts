import * as vscode from 'vscode';
import { ApprovalTreeItem } from './approvalTreeItem';
import { approvalManager, ApprovalRequest } from '../tools.d/utils';

/**
 * @description Approval request tree data provider, implements VSCode TreeDataProvider interface
 * Responsible for managing the list of approval requests for tool calls, works with approvalManager
 * @class ApprovalTreeDataProvider
 * @implements {vscode.TreeDataProvider<ApprovalTreeItem>}
 * @example
 * const provider = new ApprovalTreeDataProvider();
 * vscode.window.createTreeView('mutsumi.approvalSidebar', { treeDataProvider: provider });
 */
export class ApprovalTreeDataProvider implements vscode.TreeDataProvider<ApprovalTreeItem> {
    /** @description Tree data change event emitter for triggering view refresh */
    private _onDidChangeTreeData = new vscode.EventEmitter<ApprovalTreeItem | undefined | null>();
    
    /** @description Tree data change event that VSCode subscribes to for view updates */
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /**
     * @description Creates approval request data provider instance
     * Automatically subscribes to approvalManager's request change events to maintain data synchronization
     */
    constructor() {
        approvalManager.onDidChangeRequests(() => {
            this.refresh();
        });
    }

    /**
     * @description Gets the tree item for the specified element
     * @param {ApprovalTreeItem} element - The tree node to get
     * @returns {vscode.TreeItem} Corresponding VSCode tree item
     */
    getTreeItem(element: ApprovalTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * @description Gets child nodes of the specified element
     * @param {ApprovalTreeItem} [element] - Parent node, approval requests are a flat list, always returns empty array
     * @returns {Thenable<ApprovalTreeItem[]>} Promise of child node array
     * @example
     * const children = await provider.getChildren(item); // Returns []
     * const allRequests = await provider.getChildren(); // Returns all approval requests
     */
    getChildren(element?: ApprovalTreeItem): Thenable<ApprovalTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        // Get all requests, pending status first, same status sorted by time in descending order
        const requests = approvalManager.getAllRequests();
        requests.sort((a, b) => {
            // Pending status requests are displayed first
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            // Under the same status, newer requests are listed first
            return b.timestamp.getTime() - a.timestamp.getTime();
        });

        return Promise.resolve(requests.map(r => new ApprovalTreeItem(r)));
    }

    /**
     * @description Refreshes the approval request tree view
     * Triggers onDidChangeTreeData event to notify VSCode to re-render the view
     * @returns {void}
     * @example
     * provider.refresh(); // Refresh and re-render the approval request list
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
}
