import * as vscode from 'vscode';
import { IAgentAdapter, IAgentSession, CreateSessionOptions, AgentSessionConfig } from './interfaces';
import { AgentMessage, AgentMetadata } from '../types';
import { buildInteractionHistory } from '../contextManagement/history';

export class NotebookAdapter implements IAgentAdapter {
    constructor(
        private readonly controller: vscode.NotebookController
    ) {}

    async createSession(options: CreateSessionOptions): Promise<IAgentSession> {
        if (!options.resourceUri) {
            throw new Error('Resource URI is required for NotebookAdapter');
        }

        // Find the notebook document
        // We look for a notebook that either matches the URI directly or contains a cell with that URI
        const notebook = vscode.workspace.notebookDocuments.find(nb => 
            nb.uri.toString() === options.resourceUri?.toString() || 
            nb.getCells().some(c => c.document.uri.toString() === options.resourceUri?.toString())
        );

        if (!notebook) {
            throw new Error('Notebook document not found');
        }

        // Find the cell
        const cell = notebook.getCells().find(c => c.document.uri.toString() === options.resourceUri?.toString());
        if (!cell) {
             throw new Error('Notebook cell not found');
        }

        // Create execution
        const execution = this.controller.createNotebookCellExecution(cell);
        
        return new NotebookAgentSession(execution, notebook, options.config);
    }
}

export class NotebookAgentSession implements IAgentSession {
    public readonly id: string;
    public readonly token: vscode.CancellationToken;
    public readonly supportsUI = true;
    
    // We keep track of the accumulated output string if needed, 
    // but VSCode execution handles the actual display state.
    
    constructor(
        public readonly execution: vscode.NotebookCellExecution,
        private readonly notebook: vscode.NotebookDocument,
        private config?: AgentSessionConfig
    ) {
        this.id = execution.cell.document.uri.toString();
        this.token = execution.token;
        
        // Start timing
        this.execution.start(Date.now());
    }

    async getInput(): Promise<string> {
        return this.execution.cell.document.getText();
    }

    async getHistory(): Promise<AgentMessage[]> {
        // Use the existing context management logic
        const result = await buildInteractionHistory(
            this.notebook,
            this.execution.cell.index,
            this.execution.cell.document.getText()
        );
        
        // Populate config from history analysis if missing
        if (!this.config) {
            this.config = {};
        }
        if (!this.config.allowedUris) {
            this.config.allowedUris = result.allowedUris;
        }
        if (this.config.isSubAgent === undefined) {
            this.config.isSubAgent = result.isSubAgent;
        }

        return result.messages;
    }

    async appendOutput(content: string, options?: { isMarkdown?: boolean }): Promise<void> {
        // VSCode Notebook API "append" is actually appending output items.
        // But our UIRenderer usually constructs a full HTML string and replaces.
        // If the Runner calls appendOutput, it implies "add this chunk".
        // Since we don't have the full previous state here easily without UIRenderer logic,
        // this method assumes the content is a standalone chunk to be appended as a text/plain or markdown item.
        
        // Warning: This behaves differently from UIRenderer.appendHtml().
        // If AgentRunner expects full UIRenderer behavior (accumulating HTML), 
        // it should handle accumulation and use replaceOutput.
        
        await this.execution.appendOutput(
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(content, options?.isMarkdown ? 'text/markdown' : 'text/plain')
            ])
        );
    }

    async replaceOutput(content: string, options?: { isMarkdown?: boolean }): Promise<void> {
        // This is the primary method used by UIRenderer -> UI
        // content is the full HTML/Markdown string
        await this.execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(content, options?.isMarkdown ? 'text/markdown' : 'text/plain')
            ])
        ]);
    }

    async save(): Promise<void> {
        // Persistence is currently handled by the Controller via WorkspaceEdit on Metadata.
        // This placeholder fulfills the interface.
        // In the future, this could persist intermediate state to cell metadata.
    }

    async getConfig(): Promise<AgentSessionConfig> {
        if (!this.config) {
             const meta = this.notebook.metadata as AgentMetadata;
             this.config = {
                 model: meta.model,
                 allowedUris: meta.allowed_uris,
                 isSubAgent: !!meta.parent_agent_id
             };
        }
        return this.config;
    }

    async updateTitle(title: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const newMetadata = { ...this.notebook.metadata, name: title };
        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
        edit.set(this.notebook.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);

        // Also update in-memory config
        if (!this.config) {
            this.config = {};
        }
        if (!this.config.metadata) {
            this.config.metadata = {} as AgentMetadata;
        }
        this.config.metadata.name = title;

        // Sync with orchestrator
        const uuid = this.notebook.metadata?.uuid || this.config.metadata?.uuid;
        if (uuid) {
            const { AgentOrchestrator } = require('../agent/agentOrchestrator');
            AgentOrchestrator.getInstance().updateAgentName(uuid, title);
        }
    }

    /**
     * Completes the execution session.
     * Not part of IAgentSession but used by the Adapter/Controller.
     */
    end(success: boolean): void {
        this.execution.end(success, Date.now());
    }
}
