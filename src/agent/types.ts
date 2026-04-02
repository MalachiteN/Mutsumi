/**
 * @fileoverview Agent module type definitions for the Mutsumi VSCode extension.
 * @module agent/types
 */

import type { AgentStateInfo, AgentRuntimeStatus } from '../types';

// Re-export imported types
export type { AgentStateInfo, AgentRuntimeStatus };

/**
 * Options for configuring the agent runner.
 * @interface AgentRunOptions
 */
export interface AgentRunOptions {
    /** Model identifier to use for LLM calls */
    model: string;
    /** OpenAI API key */
    apiKey: string;
    /** Base URL for OpenAI-compatible API */
    baseUrl: string | undefined;
    /** Maximum number of tool interaction loops */
    maxLoops?: number;
}

/**
 * Dispatch session information for managing sub-agent lifecycle.
 * @interface DispatchSession
 */
export interface DispatchSession {
    /** Parent agent UUID that created this dispatch session */
    parentId: string;
    /** Resolve function to complete the dispatch session */
    resolve: (value: string[]) => void;
    /** Reject function to fail the dispatch session */
    reject: (reason?: any) => void;
    /** Set of child agent UUIDs created in this session */
    childUuids: Set<string>;
    /** Map of child agent UUID to their results */
    results: Map<string, string>;
    /** Set of child agent UUIDs that have been deleted */
    deletedChildren: Set<string>;
}