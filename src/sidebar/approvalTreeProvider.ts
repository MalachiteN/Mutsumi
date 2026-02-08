import * as vscode from 'vscode';
import { ApprovalTreeItem, EditFileTreeItem } from './approvalTreeItem';
import { approvalManager, editFileSessionManager } from '../tools.d/utils';

/**
 * Union type for tree items in the approval sidebar
 */
export type ApprovalSidebarItem = ApprovalTreeItem | EditFileTreeItem;

/**
 * @description Approval request tree data provider, implements VSCode TreeDataProvider interface
 * Responsible for managing the list of approval requests and edit file sessions, works with approvalManager and editFileSessionManager
 * @class ApprovalTreeDataProvider
 * @implements {vscode.TreeDataProvider<ApprovalSidebarItem>}
 * @example
 * const provider = new ApprovalTreeDataProvider();
 * vscode.window.createTreeView('mutsumi.approvalSidebar', { treeDataProvider: provider });
 */
export class ApprovalTreeDataProvider implements vscode.TreeDataProvider<ApprovalSidebarItem> {
    /** @description Tree data change event emitter for triggering view refresh */
    private _onDidChangeTreeData = new vscode.EventEmitter<ApprovalSidebarItem | undefined | null>();

    /** @description Tree data change event that VSCode subscribes to for view updates */
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /**
     * @description Creates approval request data provider instance
     * Automatically subscribes to approvalManager's and editFileSessionManager's change events to maintain data synchronization
     */
    constructor() {
        approvalManager.onDidChangeRequests(() => {
            this.refresh();
        });
        editFileSessionManager.onDidChangeSessions(() => {
            this.refresh();
        });
    }

    /**
     * @description Gets the tree item for the specified element
     * @param {ApprovalSidebarItem} element - The tree node to get
     * @returns {vscode.TreeItem} Corresponding VSCode tree item
     */
    getTreeItem(element: ApprovalSidebarItem): vscode.TreeItem {
        return element;
    }

    /**
     * @description Gets child nodes of the specified element
     * @param {ApprovalSidebarItem} [element] - Parent node, this is a flat list, always returns empty array for children
     * @returns {Thenable<ApprovalSidebarItem[]>} Promise of child node array
     * @example
     * const children = await provider.getChildren(item); // Returns []
     * const allItems = await provider.getChildren();  // Returns all approval requests and edit file sessions
     */
    getChildren(element?: ApprovalSidebarItem): Thenable<ApprovalSidebarItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items: ApprovalSidebarItem[] = [];

        // Get all approval requests
        const requests = approvalManager.getAllRequests();
        requests.sort((a, b) => {
            // Pending status requests are displayed first
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            // Under the same status, newer requests are listed first
            return b.timestamp.getTime() - a.timestamp.getTime();
        });
        items.push(...requests.map(r => new ApprovalTreeItem(r)));

        // Get all active edit file sessions
        const sessions = editFileSessionManager.getActiveSessions();
        items.push(...sessions.map(s => new EditFileTreeItem(s)));

        return Promise.resolve(items);
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
