import * as vscode from 'vscode';
import { AgentTreeDataProvider } from './agentTreeProvider';
import { ApprovalTreeDataProvider } from './approvalTreeProvider';
import { ContextTreeDataProvider } from './contextTreeProvider';
import { ContextTreeItem, registerContextCommands } from './contextTreeItem';
import { registerApprovalCommands } from './approvalTreeItem';
import { registerAgentCommands } from './agentTreeItem';

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

    /** @description Tree data provider for context items */
    private _contextTreeDataProvider: ContextTreeDataProvider;
    
    /** @description Agent tree view instance */
    private _agentTreeView?: vscode.TreeView<any>;
    
    /** @description Approval request tree view instance */
    private _approvalTreeView?: vscode.TreeView<any>;

    /** @description Context items tree view instance */
    private _contextTreeView?: vscode.TreeView<ContextTreeItem>;

    /**
     * @description Creates an Agent sidebar provider instance
     * @param {vscode.Uri} _extensionUri - The root URI of the extension
     */
    constructor(private readonly _extensionUri: vscode.Uri) {
        this._agentTreeDataProvider = new AgentTreeDataProvider();
        this._approvalTreeDataProvider = new ApprovalTreeDataProvider();
        this._contextTreeDataProvider = new ContextTreeDataProvider(_extensionUri);
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

        // Create context items tree view
        this._contextTreeView = vscode.window.createTreeView('mutsumi.contextSidebar', {
            treeDataProvider: this._contextTreeDataProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(this._contextTreeView);

        // Register agent-related commands
        registerAgentCommands(context);

        // Register approval-related commands
        registerApprovalCommands(context);

        // Register context-related commands
        registerContextCommands(context, this._contextTreeDataProvider);

        // Listen for active notebook editor changes
        context.subscriptions.push(
            vscode.window.onDidChangeActiveNotebookEditor((editor) => {
                if (editor && editor.notebook.uri.fsPath.endsWith('.mtm')) {
                    this._contextTreeDataProvider.setCurrentNotebook(editor.notebook);
                } else {
                    this._contextTreeDataProvider.setCurrentNotebook(undefined);
                }
            })
        );

        // Set initial notebook if there's already an active one
        if (vscode.window.activeNotebookEditor?.notebook.uri.fsPath.endsWith('.mtm')) {
            this._contextTreeDataProvider.setCurrentNotebook(vscode.window.activeNotebookEditor.notebook);
        }
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
        this._contextTreeDataProvider.refresh();
    }

    /**
     * @description Disposes the sidebar provider and all its resources
     * @returns {void}
     */
    public dispose(): void {
        this._agentTreeView?.dispose();
        this._approvalTreeView?.dispose();
        this._contextTreeView?.dispose();
    }
}
