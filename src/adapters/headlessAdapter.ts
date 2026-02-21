import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { MutsumiSerializer } from '../notebook/serializer';
import {
    IAgentAdapter,
    IAgentSession,
    AgentSessionConfig,
    CreateSessionOptions
} from './interfaces';
import type { AgentMessage, AgentMetadata, AgentContext } from '../types';

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
    private history: AgentMessage[] = [];
    private inputPrompt = '';
    private outputBuffer = '';

    constructor(options: HeadlessAgentSessionOptions) {
        this.id = options.id;
        this.resourceUri = options.resourceUri;
        this.config = options.config ?? {};
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
        this.history = history;
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

        // Rebuild cells from current history
        const cells: vscode.NotebookCellData[] = [];
        for (const msg of this.history) {
            if (msg.role === 'user') {
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    'markdown'
                );
                cell.metadata = { role: 'user', ...msg.metadata };
                cells.push(cell);
            } else if (msg.role === 'assistant') {
                const content = typeof msg.content === 'string' ? msg.content : '';
                const interaction: AgentMessage[] = [msg];

                // Include tool messages that follow this assistant message
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    content,
                    'markdown'
                );
                cell.metadata = {
                    role: 'assistant',
                    mutsumi_interaction: interaction
                };
                cells.push(cell);
            } else if (msg.role === 'tool') {
                // Tool messages are included in the previous assistant cell's interaction
                // So we skip them here - they should be handled when processing assistant cells
            }
        }

        notebookData.cells = cells;

        // Update metadata
        if (this.config.metadata) {
            notebookData.metadata = { ...notebookData.metadata, ...this.config.metadata };
        }

        const encoded = await serializer.serializeNotebook(notebookData, tokenSource.token);
        await vscode.workspace.fs.writeFile(this.resourceUri, encoded);
    }

    async getConfig(): Promise<AgentSessionConfig> {
        return this.config;
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
}
