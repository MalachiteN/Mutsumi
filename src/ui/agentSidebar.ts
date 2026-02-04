import * as vscode from 'vscode';
import { AgentTreeDataProvider } from './agentTreeProvider';
import { ApprovalTreeDataProvider } from './approvalTreeProvider';
import { approvalManager } from '../tools.d/utils';

export class AgentSidebarProvider {
    public static readonly viewType = 'mutsumi.agentSidebar';
    private _agentTreeDataProvider: AgentTreeDataProvider;
    private _approvalTreeDataProvider: ApprovalTreeDataProvider;
    private _agentTreeView?: vscode.TreeView<any>;
    private _approvalTreeView?: vscode.TreeView<any>;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._agentTreeDataProvider = new AgentTreeDataProvider();
        this._approvalTreeDataProvider = new ApprovalTreeDataProvider();
    }

    public registerTreeView(context: vscode.ExtensionContext): void {
        // Agent Tree View
        this._agentTreeView = vscode.window.createTreeView('mutsumi.agentSidebar', {
            treeDataProvider: this._agentTreeDataProvider,
            showCollapseAll: true
        });
        context.subscriptions.push(this._agentTreeView);

        // Approval Requests Tree View
        this._approvalTreeView = vscode.window.createTreeView('mutsumi.approvalSidebar', {
            treeDataProvider: this._approvalTreeDataProvider,
            showCollapseAll: false
        });
        context.subscriptions.push(this._approvalTreeView);

        // Register approval commands
        context.subscriptions.push(
            vscode.commands.registerCommand('mutsumi.approveRequest', (item: any) => {
                if (item && item.request && item.request.id) {
                    approvalManager.approveRequest(item.request.id);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('mutsumi.rejectRequest', (item: any) => {
                if (item && item.request && item.request.id) {
                    approvalManager.rejectRequest(item.request.id);
                }
            })
        );
    }

    public async update(): Promise<void> {
        await this._agentTreeDataProvider.refresh();
    }
}