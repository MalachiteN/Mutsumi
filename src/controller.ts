/**
 * @fileoverview Agent controller for executing notebook cells.
 * @module controller
 */

import * as vscode from 'vscode';
import { ToolManager } from './toolManager';
import { AgentRunner } from './agentRunner';
import { buildInteractionHistory } from './contextManagement/history';
import { AgentOrchestrator } from './agentOrchestrator';

/**
 * Controls the execution of agent notebooks.
 * @description Manages the lifecycle of agent execution, including configuration loading,
 * cell processing, and coordination with the AgentRunner for LLM interactions.
 * @class AgentController
 * @example
 * const controller = new AgentController();
 * await controller.execute(cells, notebook, notebookController);
 */
export class AgentController {
    /** Tool manager instance for providing tools to agents */
    private tools = new ToolManager();
    /** Execution order counter for tracking cell execution sequence */
    private executionOrder = 0;

    /**
     * Creates a new AgentController instance.
     * @constructor
     */
    constructor() {}

    /**
     * Executes one or more notebook cells.
     * @description Processes each cell in sequence, notifying the orchestrator of
     * start/stop events for the agent lifecycle.
     * @param {vscode.NotebookCell[]} cells - Cells to execute
     * @param {vscode.NotebookDocument} notebook - The notebook document
     * @param {vscode.NotebookController} controller - The notebook controller
     * @returns {Promise<void>}
     * @example
     * await agentController.execute([cell1, cell2], notebook, controller);
     */
    async execute(
        cells: vscode.NotebookCell[], 
        notebook: vscode.NotebookDocument, 
        controller: vscode.NotebookController
    ): Promise<void> {
        const uuid = notebook.metadata.uuid;
        if (uuid) {
            AgentOrchestrator.getInstance().notifyAgentStarted(uuid);
        }

        try {
            for (const cell of cells) {
                await this.processCell(cell, notebook, controller);
            }
        } finally {
            if (uuid) {
                AgentOrchestrator.getInstance().notifyAgentStopped(uuid);
            }
        }
    }

    /**
     * Processes a single notebook cell.
     * @description Loads configuration, initializes execution, builds context history,
     * runs the agent loop, and saves interaction metadata.
     * @private
     * @param {vscode.NotebookCell} cell - The cell to process
     * @param {vscode.NotebookDocument} notebook - The notebook document
     * @param {vscode.NotebookController} controller - The notebook controller
     * @returns {Promise<void>}
     */
    private async processCell(
        cell: vscode.NotebookCell,
        notebook: vscode.NotebookDocument,
        controller: vscode.NotebookController
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('mutsumi');
        const apiKey = config.get<string>('apiKey');
        const baseUrl = config.get<string>('baseUrl');
        const models = config.get<Array<{name: string, provider: string}>>('models') || [];
        const defaultModel = config.get<string>('defaultModel') || 'gpt-3.5-turbo';
        const model = notebook.metadata?.model || defaultModel;

        const execution = controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        if (!apiKey) {
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(
                        new Error('Please set mutsumi.apiKey in VSCode Settings.')
                    )
                ])
            ]);
            execution.end(false, Date.now());
            return;
        }

        const abortController = new AbortController();
        const tokenDisposable = execution.token.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            const { messages, allowedUris, isSubAgent } = await buildInteractionHistory(
                notebook,
                cell.index,
                cell.document.getText()
            );

            const runner = new AgentRunner(
                { apiKey, baseUrl, model },
                this.tools,
                notebook,
                allowedUris,
                isSubAgent
            );

            const newMessages = await runner.run(execution, abortController, messages);

            if (newMessages.length > 0) {
                const newMetadata = {
                    ...cell.metadata,
                    mutsumi_interaction: newMessages
                };
                const notebookEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
                const workspaceEdit = new vscode.WorkspaceEdit();
                (workspaceEdit as any).set(notebook.uri, [notebookEdit]);
                await vscode.workspace.applyEdit(workspaceEdit);
            }

            execution.end(true, Date.now());
        } catch (err: any) {
            const isCancellation = 
                err.name === 'APIUserAbortError' ||
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
