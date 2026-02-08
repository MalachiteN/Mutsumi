import * as vscode from 'vscode';
import { AgentTreeItem, AgentNodeData } from './agentTreeItem';
import { AgentOrchestrator } from '../agent/agentOrchestrator';

/**
 * @description Agent tree data provider, implements VSCode TreeDataProvider interface
 * Responsible for managing the hierarchical structure of Agents, obtaining data from AgentOrchestrator and converting it to tree display
 * @class AgentTreeDataProvider
 * @implements {vscode.TreeDataProvider<AgentTreeItem>}
 * @example
 * const provider = new AgentTreeDataProvider();
 * vscode.window.createTreeView('mutsumi.agentSidebar', { treeDataProvider: provider });
 */
export class AgentTreeDataProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    /** @description Tree data change event emitter, used to trigger view refresh */
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
    
    /** @description Tree data change event, VSCode subscribes to this event to update the view */
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** @description Root node list, caches all currently displayed Agent tree nodes */
    private rootItems: AgentTreeItem[] = [];

    /**
     * @description Gets the tree item of the specified element
     * @param {AgentTreeItem} element - The tree node to get
     * @returns {vscode.TreeItem} Corresponding VSCode tree item
     */
    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * @description Gets the child nodes of the specified element
     * @param {AgentTreeItem} [element] - Parent node, returns root node list when not specified
     * @returns {Thenable<AgentTreeItem[]>} Promise of child node array
     * @example
     * const children = await provider.getChildren(rootItem); // Get child nodes
     * const roots = await provider.getChildren(); // Get all root nodes
     */
    getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.rootItems);
        }
        return Promise.resolve(element.children);
    }

    /**
     * @description Refreshes the Agent tree view
     * Obtains the latest Agent data from AgentOrchestrator and rebuilds the hierarchical structure
     * @returns {Promise<void>}
     * @example
     * await provider.refresh(); // Refresh and re-render the entire tree
     */
    public async refresh(): Promise<void> {
        this.rootItems = [];
        const orch = AgentOrchestrator.getInstance();
        const allAgents = orch.getAgentTreeNodes();

        const nodeMap = new Map<string, AgentTreeItem>();
        
        // Create all Agent tree node items
        allAgents.forEach(info => {
            const item = new AgentTreeItem(
                {
                    uuid: info.uuid,
                    name: info.name,
                    status: orch.computeStatus(info),
                    parentId: info.parentId,
                    fileUri: info.fileUri
                },
                vscode.TreeItemCollapsibleState.Collapsed
            );
            nodeMap.set(info.uuid, item);
        });

        // Build Agent hierarchical relationships using childIds
        allAgents.forEach(info => {
            const item = nodeMap.get(info.uuid)!;
            
            // Check if this is a root node (no parent or parent not in display list)
            const isRoot = !info.parentId || !nodeMap.has(info.parentId);
            
            if (isRoot) {
                this.rootItems.push(item);
            }
            
            // Add children using childIds (bidirectional reference)
            if (info.childIds) {
                for (const childId of info.childIds) {
                    const childItem = nodeMap.get(childId);
                    if (childItem) {
                        item.children.push(childItem);
                    }
                }
            }
            
            // Set collapsible state based on whether there are children
            if (item.children.length > 0) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            } else {
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
        });

        this._onDidChangeTreeData.fire(null);
    }

    /**
     * @description Gets the corresponding Agent tree node by UUID
     * @param {string} uuid - Unique identifier of the Agent
     * @returns {AgentTreeItem | undefined} Found tree node, returns undefined if not found
     */
    public getAgentItem(uuid: string): AgentTreeItem | undefined {
        // Search in root items and their children recursively
        const searchInItems = (items: AgentTreeItem[]): AgentTreeItem | undefined => {
            for (const item of items) {
                if (item.agentData.uuid === uuid) {
                    return item;
                }
                const found = searchInItems(item.children);
                if (found) return found;
            }
            return undefined;
        };
        
        return searchInItems(this.rootItems);
    }
}