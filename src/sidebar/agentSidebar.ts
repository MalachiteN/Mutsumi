import * as vscode from 'vscode';
import { AgentTreeDataProvider } from './agentTreeProvider';
import { ApprovalTreeDataProvider } from './approvalTreeProvider';
import { approvalManager } from '../tools.d/utils';

/**
 * @description Main controller for the Agent sidebar
 * Responsible for registering and managing the Agent tree view and approval request tree view, coordinating the interaction between the two data providers
 * @class AgentSidebarProvider
 * @example
 * const sidebar = new AgentSidebarProvider(extensionUri);
 * sidebar.registerTreeView(context);
 */
export class AgentSidebarProvider {
    /** @description View type identifier for the Agent sidebar */
    public static readonly viewType = 'mutsumi.agentSidebar';
    
    /** @description Tree data provider for Agents */
    private _agentTreeDataProvider: AgentTreeDataProvider;
    
    /** @description Tree data provider for approval requests */
    private _approvalTreeDataProvider: ApprovalTreeDataProvider;
    
    /** @description Agent tree view instance */
    private _agentTreeView?: vscode.TreeView<any>;
    
    /** @description Approval request tree view instance */
    private _approvalTreeView?: vscode.TreeView<any>;

    /**
     * @description Creates an Agent sidebar provider instance
     * @param {vscode.Uri} _extensionUri - The root URI of the extension
     */
    constructor(private readonly _extensionUri: vscode.Uri) {
        this._agentTreeDataProvider = new AgentTreeDataProvider();
        this._approvalTreeDataProvider = new ApprovalTreeDataProvider();
    }

    /**
     * @description Registers tree views and related commands to the VSCode extension context
     * @param {vscode.ExtensionContext} context - Extension context for registering subscriptions
     * @returns {void}
     * @example
     * sidebar.registerTreeView(context);
     */
    public registerTreeView(context: vscode.ExtensionContext): void {
        // Create Agent tree view
        this._agentTreeView = vscode.window.createTreeView('mutsumi.agentSidebar', {
            treeDataProvider: this._agentTreeDataProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(this._agentTreeView);

        // Create approval request tree view
        this._approvalTreeView = vscode.window.createTreeView('mutsumi.approvalSidebar', {
            treeDataProvider: this._approvalTreeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(this._approvalTreeView);

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
    }

    /**
     * @description Updates the Agent tree view
     * Triggers the refresh operation of the Agent data provider
     * @returns {Promise<void>}
     * @example
     * await sidebar.update(); // Refresh the Agent tree to show the latest status
     */
    public async update(): Promise<void> {
        await this._agentTreeDataProvider.refresh();
    }
}
