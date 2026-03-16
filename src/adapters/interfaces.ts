/**
 * @fileoverview Adapter layer interfaces to decouple AgentRunner from UI implementations.
 * @module adapters/interfaces
 */

import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, ContextItem } from '../types';

/**
 * Configuration for an agent session.
 * This should be UI-agnostic and portable across Notebook/HTTP adapters.
 */
export interface AgentSessionConfig {
    /** Model identifier for the session (e.g. gpt-4o-mini) */
    model?: string;
    /** API key for OpenAI-compatible endpoints */
    apiKey?: string;
    /** Base URL for OpenAI-compatible endpoints */
    baseUrl?: string;
    /** Max tool/LLM loops allowed in a single run */
    maxLoops?: number;
    /** Allowed URI strings for tool access */
    allowedUris?: string[];
    /** Whether this session represents a sub-agent */
    isSubAgent?: boolean;
    /** Optional persisted metadata */
    metadata?: AgentMetadata;
    /** Optional resource URI for the session */
    resourceUri?: string;
}

/**
 * Options for creating or retrieving a session.
 */
export interface CreateSessionOptions {
    /** Existing session identifier (if rehydrating) */
    sessionId?: string;
    /** Backing resource URI (Notebook, file, remote id, etc.) */
    resourceUri?: vscode.Uri;
    /** Initial configuration overrides */
    config?: AgentSessionConfig;
}

/**
 * Adapter entrypoint for managing agent sessions.
 * Implementations bridge AgentRunner to UI or transport layers.
 */
export interface IAgentAdapter {
    /** Initialize adapter lifecycle (optional for stateless adapters) */
    activate?(): Promise<void> | void;
    /** Create or rehydrate a session for the given options */
    createSession(options?: CreateSessionOptions): Promise<IAgentSession>;
    /** Retrieve an existing session by ID, if supported */
    getSession?(sessionId: string): Promise<IAgentSession | undefined> | IAgentSession | undefined;
    /** Dispose the adapter (optional) */
    dispose?(): Promise<void> | void;
}

/**
 * Core interaction surface used by AgentRunner.
 * This is UI-agnostic and supports Notebook and HTTP-style adapters.
 */
export interface IAgentSession {
    /** Unique identifier for the session */
    readonly id: string;
    /** Cancellation token for the current run */
    readonly token: vscode.CancellationToken;
    /** Whether this session supports UI features */
    readonly supportsUI: boolean;

    /**
     * Get the current user input prompt.
     */
    getInput(): Promise<string>;

    /**
     * Get the full conversation history.
     */
    getHistory(): Promise<AgentMessage[]>;

    /**
     * Append output content (streaming UI updates).
     */
    appendOutput(content: string, options?: { isMarkdown?: boolean }): Promise<void>;

    /**
     * Replace current output (full refresh).
     */
    replaceOutput(content: string, options?: { isMarkdown?: boolean }): Promise<void>;

    /**
     * Persist current session state (Notebook metadata, .mtm file, etc.).
     */
    save(): Promise<void>;

    /**
     * Get the session configuration.
     */
    getConfig(): Promise<AgentSessionConfig>;

    /**
     * Set the session configuration.
     * Updates the in-memory config which will be persisted on next save().
     * @param config - The new configuration (partial updates are merged)
     */
    setConfig(config: Partial<AgentSessionConfig>): void;

    /**
     * Update the session title.
     * @param title - The new title for the session
     */
    updateTitle(title: string): Promise<void>;

    /**
     * Set the full interaction history to be saved.
     * Used by NotebookAdapter to persist cell-specific history.
     */
    setHistory(messages: AgentMessage[]): void;

    /**
     * Get the current output content.
     * Used for streaming responses in headless/HTTP mode.
     */
    getCurrentOutput?(): Promise<string>;

    /**
     * Get ghost blocks from previous messages for content version tracking.
     * Each ghost block corresponds to a previous user message's context.
     * Used by history.ts for differential context updates.
     * @returns Array of ghost block strings, indexed by message position
     */
    getPreviousGhostBlocks?(): Promise<string[]>;

    /**
     * Persist ghost block for the current message.
     * Called after processing current prompt to save context references.
     * @param ghostBlock - The formatted ghost block string to persist
     */
    persistGhostBlock?(ghostBlock: string): Promise<void>;

    /**
     * Update persisted context items after processing.
     * Called to save file hashes, versions, and other context metadata.
     * @param items - The context items to persist
     */
    updateContextItems?(items: ContextItem[]): Promise<void>;
}

/**
 * Cell-level metadata for notebook-style adapters.
 * Used to persist per-cell state like ghost blocks.
 */
export interface CellMetadata {
    /** Persisted ghost block from this cell's context */
    last_ghost_block?: string;
    /** Message role (user/assistant) */
    role?: string;
    /** Pre-built interaction array for assistant cells */
    mutsumi_interaction?: AgentMessage[];
    /** Other arbitrary metadata */
    [key: string]: any;
}
