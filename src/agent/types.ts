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