import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import {
    IAgentAdapter,
    IAgentSession,
    AgentSessionConfig,
    CreateSessionOptions
} from './interfaces';
import { AgentMessage, ContextItem } from '../types';

/**
 * Lightweight session config for utility/background agent tasks.
 * It intentionally has no UI binding and no persistence target.
 */
export interface LiteAgentSessionConfig extends AgentSessionConfig {
    input?: string;
    history?: AgentMessage[];
}

export class LiteAdapter implements IAgentAdapter {
    private sessions = new Map<string, LiteAgentSession>();

    async createSession(options?: CreateSessionOptions): Promise<IAgentSession> {
        const sessionId = options?.sessionId ?? uuidv4();
        const session = new LiteAgentSession(sessionId, options?.config as LiteAgentSessionConfig | undefined);
        this.sessions.set(sessionId, session);
        return session;
    }

    getSession(sessionId: string): IAgentSession | undefined {
        return this.sessions.get(sessionId);
    }
}

export class LiteAgentSession implements IAgentSession {
    readonly id: string;
    readonly supportsUI = false;
    readonly token: vscode.CancellationToken;

    private readonly tokenSource = new vscode.CancellationTokenSource();
    private config: LiteAgentSessionConfig;
    private inputPrompt = '';
    private history: AgentMessage[] = [];
    private outputBuffer = '';
    private ghostBlocks: string[] = [];

    constructor(id: string, config?: LiteAgentSessionConfig) {
        this.id = id;
        this.config = config ?? {};
        this.token = this.tokenSource.token;
        this.inputPrompt = this.config.input ?? '';
        this.history = this.config.history ?? [];
    }

    async getInput(): Promise<string> {
        return this.inputPrompt;
    }

    async getHistory(): Promise<AgentMessage[]> {
        return this.history;
    }

    async appendOutput(content: string): Promise<void> {
        this.outputBuffer += content;
    }

    async replaceOutput(content: string): Promise<void> {
        this.outputBuffer = content;
    }

    async save(): Promise<void> {
        // Lite sessions are intentionally ephemeral and do not persist.
    }

    async getConfig(): Promise<AgentSessionConfig> {
        return this.config;
    }

    setConfig(config: Partial<AgentSessionConfig>): void {
        // Merge the new config, deep cloning metadata to avoid read-only issues
        this.config = {
            ...this.config,
            ...config,
            metadata: config.metadata
                ? JSON.parse(JSON.stringify({ ...this.config.metadata, ...config.metadata }))
                : this.config.metadata
        };
    }

    async updateTitle(title: string): Promise<void> {
        if (!this.config.metadata) {
            this.config.metadata = { name: title } as any;
        } else {
            // Create a mutable copy to avoid modifying potentially read-only objects
            this.config.metadata = { ...this.config.metadata, name: title };
        }
    }

    setHistory(messages: AgentMessage[]): void {
        this.history = messages;
    }

    async getCurrentOutput(): Promise<string> {
        return this.outputBuffer;
    }

    /**
     * Get ghost blocks from previous messages.
     * For Lite sessions, returns the in-memory ghost blocks.
     */
    async getPreviousGhostBlocks(): Promise<string[]> {
        return [...this.ghostBlocks];
    }

    /**
     * Persist ghost block for the current message.
     * For Lite sessions, simply adds to the in-memory array.
     */
    async persistGhostBlock(ghostBlock: string): Promise<void> {
        this.ghostBlocks.push(ghostBlock);
    }

    /**
     * Update context items in session metadata.
     * For Lite sessions, updates in-memory config only (no persistence).
     */
    async updateContextItems(items: ContextItem[]): Promise<void> {
        if (!this.config.metadata) {
            this.config.metadata = { contextItems: items } as any;
        } else {
            this.config.metadata = { ...this.config.metadata, contextItems: items };
        }
    }
}
