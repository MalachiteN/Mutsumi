/**
 * @fileoverview Agent module type definitions for the Mutsumi VSCode extension.
 * @module agent/types
 */

import type { AgentStateInfo, AgentRuntimeStatus } from '../types';

// Re-export imported types
export type { AgentStateInfo, AgentRuntimeStatus };

/**
 * Fork session information for managing sub-agent lifecycle.
 * @interface ForkSession
 */
export interface ForkSession {
    /** Parent agent UUID that created this fork session */
    parentId: string;
    /** Resolve function to complete the fork session */
    resolve: (value: string[]) => void;
    /** Reject function to fail the fork session */
    reject: (reason?: any) => void;
    /** Set of child agent UUIDs created in this session */
    childUuids: Set<string>;
    /** Map of child agent UUID to their results */
    results: Map<string, string>;
    /** Set of child agent UUIDs that have been deleted */
    deletedChildren: Set<string>;
}

/**
 * Tree node structure for representing agent hierarchy.
 * Used for tree view rendering and operations.
 * @interface AgentTreeNode
 */
export interface AgentTreeNode {
    /** Unique identifier for the agent */
    uuid: string;
    /** Display name of the agent */
    name: string;
    /** Runtime status of the agent */
    status: AgentRuntimeStatus;
    /** Whether the agent is currently running */
    isRunning: boolean;
    /** Whether the agent task has finished */
    isTaskFinished: boolean;
    /** Parent agent ID, null for root agents */
    parentId: string | null;
    /** Child agent nodes */
    children: AgentTreeNode[];
    /** The agent's state information */
    stateInfo: AgentStateInfo;
}

/**
 * Options for creating a new agent.
 * @interface CreateAgentOptions
 */
export interface CreateAgentOptions {
    /** Unique identifier for the new agent */
    uuid: string;
    /** Parent agent ID if this is a sub-agent */
    parentId: string | null;
    /** Initial prompt/task description for the agent */
    prompt: string;
    /** List of URIs the agent is allowed to access */
    allowedUris: string[];
    /** Model identifier to use for this agent */
    model: string;
}
