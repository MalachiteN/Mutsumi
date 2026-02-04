import * as vscode from 'vscode';
import { ToolManager } from './toolManager';
import { AgentRunner } from './agentRunner';
import { buildInteractionHistory } from './contextManagement/history';
import { AgentOrchestrator } from './agentOrchestrator';

export class AgentController {
    private tools = new ToolManager();
    private executionOrder = 0;

    constructor() {}

    async execute(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController) {
        const uuid = notebook.metadata.uuid;
        if (uuid) AgentOrchestrator.getInstance().notifyAgentStarted(uuid);

        try {
            // Only process the last cell if it's a User cell (standard chat interaction)
            // But in notebooks, users might execute any cell. We assume the triggered cell is the prompt.
            for (const cell of cells) {
                await this.processCell(cell, notebook, controller);
            }
        } finally {
            if (uuid) AgentOrchestrator.getInstance().notifyAgentStopped(uuid);
        }
    }

    private async processCell(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ) {
        // 1. Get Configuration
        const config = vscode.workspace.getConfiguration('mutsumi');
        const apiKey = config.get<string>('apiKey');
        const baseUrl = config.get<string>('baseUrl');
        const model = config.get<string>('model') || 'gpt-3.5-turbo';

        // 2. Initialize Execution
        const execution = controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        if (!apiKey) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(new Error('Please set mutsumi.apiKey in VSCode Settings.'))
                ])
            ]);
            execution.end(false, Date.now());
            return;
        }

        // Create AbortController
        const abortController = new AbortController();
        const tokenDisposable = execution.token.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            // 3. Prepare Context (History)
            const { messages, allowedUris, isSubAgent } = await buildInteractionHistory(
                notebook,
                cell.index,
                cell.document.getText()
            );

            // 4. Initialize Runner
            const runner = new AgentRunner(
                { apiKey, baseUrl, model },
                this.tools,
                notebook,
                allowedUris,
                isSubAgent
            );

            // 5. Run Agent Loop
            const newMessages = await runner.run(execution, abortController, messages);

            // 6. Save Interaction Metadata
            if (newMessages.length > 0) {
                const newMetadata = {
                    ...cell.metadata,
                    mutsumi_interaction: newMessages
                };
                const notebookEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
                const workspaceEdit = new vscode.WorkspaceEdit();
                // Use the NotebookEdit-specific overload of set()
                (workspaceEdit as any).set(notebook.uri, [notebookEdit]);
                await vscode.workspace.applyEdit(workspaceEdit);
            }

            execution.end(true, Date.now());

        } catch (err: any) {
            // Check for cancellation or specific API errors
            const isCancellation = 
                err.name === 'APIUserAbortError' || // OpenAI specific
                err.name === 'AbortError' || 
                execution.token.isCancellationRequested;

            if (isCancellation) {
                execution.end(false, Date.now()); 
                return;
            }

            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(err)
                ])
            ]);
            execution.end(false, Date.now());
        } finally {
            tokenDisposable.dispose();
        }
    }
}