import * as vscode from 'vscode';
import { AgentRuntimeStatus } from '../types';

/**
 * @description Agent node data interface, defining the basic information of Agent tree items
 * @interface AgentNodeData
 */
export interface AgentNodeData {
    /** @description Unique identifier of the Agent */
    uuid: string;
    /** @description Display name of the Agent */
    name: string;
    /** @description Current running status of the Agent */
    status: AgentRuntimeStatus;
    /** @description UUID of the parent Agent, null indicates root node */
    parentId?: string | null;
    /** @description File URI associated with the Agent */
    fileUri: string;
}

/**
 * @description Agent tree node item for displaying Agent hierarchical structure in the sidebar
 * @class AgentTreeItem
 * @extends {vscode.TreeItem}
 * @example
 * const item = new AgentTreeItem(agentData, vscode.TreeItemCollapsibleState.Collapsed);
 */
export class AgentTreeItem extends vscode.TreeItem {
    /** @description List of child Agent nodes */
    public children: AgentTreeItem[] = [];

    /**
     * @description Creates a new Agent tree node item
     * @param {AgentNodeData} agentData - Agent node data
     * @param {vscode.TreeItemCollapsibleState} collapsibleState - Collapsible state of the node
     */
    constructor(
        public readonly agentData: AgentNodeData,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(agentData.name, collapsibleState);
        
        this.description = this.getStatusLabel(agentData.status);
        this.iconPath = this.getIconPath(agentData.status);
        
        /**
         * Sets contextValue based on parentId to distinguish between root Agent and child Agent
         * This value is used to control the display options of the context menu
         */
        this.contextValue = agentData.parentId ? 'childAgent' : 'rootAgent';

        /**
         * Does not set the command property to maintain default tree node behavior
         * Left-click will toggle the collapse/expand state of the node
         */
        this.command = undefined; 
    }

    /**
     * @description Gets the corresponding display label based on Agent status
     * @private
     * @param {AgentRuntimeStatus} status - Running status of the Agent
     * @returns {string} Localized display text of the status
     * @example
     * const label = this.getStatusLabel('running'); // Returns 'Running'
     */
    private getStatusLabel(status: AgentRuntimeStatus): string {
        switch (status) {
            case 'running': return 'Running';
            case 'pending': return 'Pending';
            case 'finished': return 'Finished';
            case 'standby': return 'Standby';
            default: return '';
        }
    }

    /**
     * @description Gets the corresponding icon based on Agent status
     * @private
     * @param {AgentRuntimeStatus} status - Running status of the Agent
     * @returns {vscode.ThemeIcon} Corresponding theme icon
     * @example
     * const icon = this.getIconPath('running'); // Returns spinning sync icon
     */
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
