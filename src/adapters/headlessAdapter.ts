import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { MutsumiSerializer } from '../notebook/serializer';
import {
    messagesToGenericCells,
    genericCellsToMessages,
    extractGhostBlocksFromCells
} from '../notebook/serializer';
import {
    IAgentAdapter,
    IAgentSession,
    AgentSessionConfig,
    CreateSessionOptions
} from './interfaces';
import type { AgentMessage, AgentMetadata, AgentContext, ContextItem } from '../types';

export class HeadlessAdapter implements IAgentAdapter {
    private sessions = new Map<string, HeadlessAgentSession>();

    constructor() {
        // HTTP server logic has been moved to HttpServer class
    }

    activate(): void {
        // Activation logic handled by HttpServer
    }

    dispose(): void {
        // Cleanup handled by HttpServer
    }

    async createSession(options?: CreateSessionOptions): Promise<IAgentSession> {
        const sessionId = options?.sessionId ?? uuidv4();
        const session = new HeadlessAgentSession({
            id: sessionId,
            resourceUri: options?.resourceUri,
            config: options?.config
        });
        this.sessions.set(sessionId, session);
        return session;
    }

    getSession(sessionId: string): IAgentSession | undefined {
        return this.sessions.get(sessionId);
    }
}

interface HeadlessAgentSessionOptions {
    id: string;
    resourceUri?: vscode.Uri;
    config?: AgentSessionConfig;
}

export class HeadlessAgentSession implements IAgentSession {
    readonly id: string;
    readonly token: vscode.CancellationToken;
    readonly supportsUI = false;
    private readonly tokenSource = new vscode.CancellationTokenSource();
    private readonly resourceUri?: vscode.Uri;
    private config: AgentSessionConfig;
    private history: AgentMessage[] = [];  // Raw (unexpanded) history from file
    private fullHistory: AgentMessage[] | undefined;  // Full expanded history from setHistory
    private inputPrompt = '';
    private outputBuffer = '';
    private pendingGhostBlock?: string;  // Ghost block for current message (applied on save)

    constructor(options: HeadlessAgentSessionOptions) {
        this.id = options.id;
        this.resourceUri = options.resourceUri;
        // Deep clone config to avoid external mutations affecting internal state
        this.config = options.config
            ? JSON.parse(JSON.stringify(options.config)) as AgentSessionConfig
            : {};
        this.token = this.tokenSource.token;
    }

    async getInput(): Promise<string> {
        return this.inputPrompt;
    }

    setInput(prompt: string): void {
        this.inputPrompt = prompt;
    }

    async getHistory(): Promise<AgentMessage[]> {
        if (this.resourceUri && this.history.length === 0) {
            try {
                const content = await vscode.workspace.fs.readFile(this.resourceUri);
                const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;
                if (Array.isArray(data.context)) {
                    this.history = data.context;
                }
                if (data.metadata?.model && !this.config.model) {
                    this.config.model = data.metadata.model;
                }
            } catch {
                // Ignore, return cached history
            }
        }
        return this.history;
    }

    setHistory(history: AgentMessage[]): void {
        // Store the full expanded history
        this.fullHistory = history;
    }

    async appendOutput(content: string): Promise<void> {
        this.outputBuffer += content;
    }

    async replaceOutput(content: string): Promise<void> {
        this.outputBuffer = content;
    }

    async getCurrentOutput(): Promise<string> {
        return this.outputBuffer;
    }

    async save(): Promise<void> {
        if (!this.resourceUri) return;

        const serializer = new MutsumiSerializer();
        const tokenSource = new vscode.CancellationTokenSource();
        let notebookData: vscode.NotebookData | undefined;

        try {
            const raw = await vscode.workspace.fs.readFile(this.resourceUri);
            notebookData = await serializer.deserializeNotebook(raw, tokenSource.token);
        } catch {
            notebookData = new vscode.NotebookData([]);
        }

        if (!notebookData.metadata) {
            notebookData.metadata = {
                uuid: this.id,
                name: 'Headless Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: this.config.allowedUris ?? []
            } as AgentMetadata;
        }

        // Use generic cell conversion for consistent behavior
        const sourceHistory = this.fullHistory || this.history;
        const genericCells = messagesToGenericCells(sourceHistory);

        // Apply the current ghost block to the last user cell if exists
        if (this.pendingGhostBlock !== undefined && genericCells.length > 0) {
            // Find the last user cell
            for (let i = genericCells.length - 1; i >= 0; i--) {
                const cell = genericCells[i];
                if (cell.kind === 2) {  // Code cell = user
                    cell.metadata = cell.metadata || {};
                    cell.metadata.last_ghost_block = this.pendingGhostBlock;
                    break;
                }
            }
        }

        // Convert generic cells to VSCode cells
        notebookData.cells = genericCells.map(genCell => 
            new vscode.NotebookCellData(
                genCell.kind === 2 ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
                genCell.value,
                'markdown'
            )
        );

        // Apply metadata to cells
        for (let i = 0; i < genericCells.length && i < notebookData.cells.length; i++) {
            notebookData.cells[i].metadata = genericCells[i].metadata;
        }

        // Update metadata
        if (this.config.metadata) {
            notebookData.metadata = { ...notebookData.metadata, ...this.config.metadata };
        }

        const encoded = await serializer.serializeNotebook(notebookData, tokenSource.token);
        await vscode.workspace.fs.writeFile(this.resourceUri, encoded);

        // Clear pending state after successful save
        this.pendingGhostBlock = undefined;
    }

    async getConfig(): Promise<AgentSessionConfig> {
        // Return deep clone to prevent external modifications affecting internal state
        return JSON.parse(JSON.stringify(this.config)) as AgentSessionConfig;
    }

    setConfig(config: Partial<AgentSessionConfig>): void {
        // Merge the new config into existing config
        this.config = {
            ...this.config,
            ...config,
            metadata: config.metadata 
                ? { ...this.config.metadata, ...config.metadata }
                : this.config.metadata
        };
    }

    async updateTitle(title: string): Promise<void> {
        // Update in-memory config
        if (!this.config.metadata) {
            this.config.metadata = {
                uuid: this.id,
                name: title,
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: this.config.allowedUris ?? []
            } as AgentMetadata;
        } else {
            this.config.metadata.name = title;
        }

        // Sync with orchestrator
        if (this.id) {
            const { AgentOrchestrator } = require('../agent/agentOrchestrator');
            AgentOrchestrator.getInstance().updateAgentName(this.id, title);
        }

        // Persist to file
        await this.save();
    }

    /**
     * Get ghost blocks from previous messages for content version tracking.
     * Converts messages to cells and extracts ghost blocks (same logic as NotebookAdapter).
     */
    async getPreviousGhostBlocks(): Promise<string[]> {
        // Convert messages to generic cells and extract ghost blocks
        const cells = messagesToGenericCells(this.history);
        return extractGhostBlocksFromCells(cells);
    }

    /**
     * Persist ghost block for the current message.
     * Stored pending until save() writes it to file.
     */
    async persistGhostBlock(ghostBlock: string): Promise<void> {
        this.pendingGhostBlock = ghostBlock;
    }

    /**
     * Update context items in session metadata.
     */
    async updateContextItems(items: ContextItem[]): Promise<void> {
        if (!this.config.metadata) {
            this.config.metadata = {
                uuid: this.id,
                name: 'Headless Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: this.config.allowedUris ?? [],
                contextItems: items
            } as AgentMetadata;
        } else {
            this.config.metadata.contextItems = items;
        }
    }
}
