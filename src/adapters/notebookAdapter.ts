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
    private initialHistoryLength: number = 0;
    private fullHistory: AgentMessage[] | undefined;
    private config?: AgentSessionConfig;
    
    // We keep track of the accumulated output string if needed, 
    // but VSCode execution handles the actual display state.
    
    constructor(
        public readonly execution: vscode.NotebookCellExecution,
        private readonly notebook: vscode.NotebookDocument,
        config?: AgentSessionConfig
    ) {
        this.id = execution.cell.document.uri.toString();
        this.token = execution.token;
        
        // Deep clone config to avoid read-only issues with VSCode's frozen metadata
        if (config) {
            this.config = JSON.parse(JSON.stringify(config)) as AgentSessionConfig;
        }
        
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

        // Record initial history length to calculate diff for save()
        this.initialHistoryLength = result.messages.length;

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

    setHistory(messages: AgentMessage[]): void {
        this.fullHistory = messages;
    }

    async save(): Promise<void> {
        // Persist metadata changes and interaction history to the notebook via WorkspaceEdit
        // This updates VSCode's buffer (dirty state), which will be saved to disk
        // by user action or auto-save

        const edits: vscode.NotebookEdit[] = [];

        // 1. Metadata Update
        if (this.config?.metadata) {
            const newMetadata = { ...this.notebook.metadata, ...this.config.metadata };
            edits.push(vscode.NotebookEdit.updateNotebookMetadata(newMetadata));
        }

        // 2. Cell Interaction Update
        // Calculate the new interaction part by slicing off the initial history
        if (this.fullHistory && this.fullHistory.length > this.initialHistoryLength) {
            const newInteraction = this.fullHistory.slice(this.initialHistoryLength);
            
            const newCellMetadata = {
                ...this.execution.cell.metadata,
                mutsumi_interaction: newInteraction
            };
            edits.push(vscode.NotebookEdit.updateCellMetadata(this.execution.cell.index, newCellMetadata));
        }

        if (edits.length > 0) {
            const edit = new vscode.WorkspaceEdit();
            edit.set(this.notebook.uri, edits);
            await vscode.workspace.applyEdit(edit);
        }
    }

    async getConfig(): Promise<AgentSessionConfig> {
        if (!this.config) {
             const meta = this.notebook.metadata as AgentMetadata;
             // Deep clone metadata to avoid referencing VSCode's frozen object
             const metaCopy = meta ? JSON.parse(JSON.stringify(meta)) as AgentMetadata : undefined;
             this.config = {
                 model: meta?.model,
                 allowedUris: meta?.allowed_uris,
                 isSubAgent: !!meta?.parent_agent_id,
                 metadata: metaCopy
             };
        }
        // Always return a deep clone to prevent external modifications affecting internal state
        return JSON.parse(JSON.stringify(this.config)) as AgentSessionConfig;
    }

    setConfig(config: Partial<AgentSessionConfig>): void {
        if (!this.config) {
            this.config = {};
        }
        // Merge the new config, deep cloning metadata to avoid read-only issues
        this.config = {
            ...this.config,
            ...config,
            metadata: config.metadata 
                ? JSON.parse(JSON.stringify(config.metadata)) as AgentMetadata 
                : this.config.metadata
        };
    }

    async updateTitle(title: string): Promise<void> {
        const { debugLogger } = require('../debugLogger');
        debugLogger.log(`[NotebookAdapter] updateTitle called: "${title}"`);

        try {
            const edit = new vscode.WorkspaceEdit();
            // Use deep clone to avoid readonly issues with VSCode's frozen metadata
            const newMetadata = JSON.parse(JSON.stringify({ ...this.notebook.metadata, name: title }));
            const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
            edit.set(this.notebook.uri, [nbEdit]);
            await vscode.workspace.applyEdit(edit);
            debugLogger.log(`[NotebookAdapter] Notebook metadata updated with title: "${title}"`);
        } catch (err) {
            debugLogger.log(`[NotebookAdapter] ERROR updating notebook metadata: ${err}`);
        }

        try {
            // Also update in-memory config
            if (!this.config) {
                this.config = {};
            }
            if (!this.config.metadata) {
                this.config.metadata = {} as AgentMetadata;
            }
            this.config.metadata.name = title;
            debugLogger.log(`[NotebookAdapter] In-memory config updated`);
        } catch (err) {
            debugLogger.log(`[NotebookAdapter] ERROR updating in-memory config: ${err}`);
        }

        try {
            // Sync with orchestrator
            const notebookUuid = this.notebook.metadata?.uuid;
            const configUuid = this.config?.metadata?.uuid;
            const uuid = notebookUuid || configUuid;
            debugLogger.log(`[NotebookAdapter] UUID sources - notebook.metadata.uuid: ${notebookUuid}, config.metadata.uuid: ${configUuid}`);
            debugLogger.log(`[NotebookAdapter] Attempting registry sync with uuid: ${uuid}`);
            if (uuid) {
                const { AgentOrchestrator } = require('../agent/agentOrchestrator');
                const { AgentRegistry } = require('../agent/registry');
                const orchestrator = AgentOrchestrator.getInstance();
                const registry = AgentRegistry.getInstance();
                const agent = registry.getAgent(uuid);
                debugLogger.log(`[NotebookAdapter] Registry lookup for uuid ${uuid}: ${agent ? `found "${agent.name}"` : 'NOT FOUND'}`);
                orchestrator.updateAgentName(uuid, title);
                orchestrator.refreshUI();
                debugLogger.log(`[NotebookAdapter] Registry sync completed`);
            } else {
                debugLogger.log(`[NotebookAdapter] No uuid available for registry sync`);
            }
        } catch (err) {
            debugLogger.log(`[NotebookAdapter] ERROR during registry sync: ${err}`);
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
