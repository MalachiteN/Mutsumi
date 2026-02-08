/**
 * @fileoverview Fork Session Manager - Manages lifecycle of fork sessions for sub-agents.
 * @module fork
 */

import { AgentStateInfo } from './types';

/**
 * Represents an active fork session with its state and callbacks.
 * @interface ForkSession
 */
interface ForkSession {
    /** Parent agent ID that initiated the fork */
    parentId: string;
    /** Resolve callback for the fork promise */
    resolve: (value: string | PromiseLike<string>) => void;
    /** Reject callback for the fork promise */
    reject: (reason?: any) => void;
    /** Set of child agent UUIDs in this session */
    childUuids: Set<string>;
    /** Map of child UUID to their result reports */
    results: Map<string, string>;
    /** Set of child UUIDs that were deleted */
    deletedChildren: Set<string>;
}

/**
 * Manages fork sessions for sub-agents.
 * @description Handles creation, tracking, and completion of fork sessions.
 * Each fork session represents a parent agent waiting for multiple sub-agents to complete.
 * @class ForkSessionManager
 * @example
 * const manager = ForkSessionManager.getInstance();
 * manager.createSession(parentId, childUuids, resolve, reject);
 * manager.addResult(parentId, childUuid, result);
 * if (manager.isSessionComplete(parentId)) {
 *   const report = manager.generateReport(parentId, registry);
 * }
 */
export class ForkSessionManager {
    /** Singleton instance */
    private static instance: ForkSessionManager;

    /** Active fork sessions (ParentUUID -> Session) */
    private activeForks = new Map<string, ForkSession>();

    /**
     * Private constructor to enforce singleton pattern.
     * @private
     * @constructor
     */
    private constructor() {}

    /**
     * Gets the singleton instance of ForkSessionManager.
     * @static
     * @returns {ForkSessionManager} The singleton instance
     * @example
     * const manager = ForkSessionManager.getInstance();
     */
    public static getInstance(): ForkSessionManager {
        if (!ForkSessionManager.instance) {
            ForkSessionManager.instance = new ForkSessionManager();
        }
        return ForkSessionManager.instance;
    }

    /**
     * Creates a new fork session.
     * @param {string} parentId - Parent agent ID that initiated the fork
     * @param {Set<string>} childUuids - Set of child agent UUIDs in this session
     * @param {(value: string | PromiseLike<string>) => void} resolve - Resolve callback
     * @param {(reason?: any) => void} reject - Reject callback
     * @returns {ForkSession} The created session
     * @example
     * const session = manager.createSession(
     *   parentId,
     *   new Set(['child-1', 'child-2']),
     *   resolve,
     *   reject
     * );
     */
    public createSession(
        parentId: string,
        childUuids: Set<string>,
        resolve: (value: string | PromiseLike<string>) => void,
        reject: (reason?: any) => void
    ): ForkSession {
        const session: ForkSession = {
            parentId,
            resolve,
            reject,
            childUuids,
            results: new Map(),
            deletedChildren: new Set()
        };
        this.activeForks.set(parentId, session);
        return session;
    }

    /**
     * Gets a fork session by parent ID.
     * @param {string} parentId - Parent agent ID
     * @returns {ForkSession | undefined} The session or undefined if not found
     * @example
     * const session = manager.getSession(parentId);
     * if (session) {
     *   // process session
     * }
     */
    public getSession(parentId: string): ForkSession | undefined {
        return this.activeForks.get(parentId);
    }

    /**
     * Deletes a fork session.
     * @param {string} parentId - Parent agent ID of the session to delete
     * @returns {boolean} True if session was deleted, false if not found
     * @example
     * const deleted = manager.deleteSession(parentId);
     */
    public deleteSession(parentId: string): boolean {
        return this.activeForks.delete(parentId);
    }

    /**
     * Checks if a fork session exists.
     * @param {string} parentId - Parent agent ID to check
     * @returns {boolean} True if session exists
     * @example
     * if (manager.hasSession(parentId)) {
     *   // session exists
     * }
     */
    public hasSession(parentId: string): boolean {
        return this.activeForks.has(parentId);
    }

    /**
     * Adds a result from a child agent to the session.
     * @param {string} parentId - Parent agent ID of the session
     * @param {string} childUuid - Child agent UUID that produced the result
     * @param {string} result - The result report from the child agent
     * @returns {boolean} True if result was added, false if session or child not found
     * @example
     * manager.addResult(parentId, childUuid, 'Task completed successfully');
     */
    public addResult(parentId: string, childUuid: string, result: string): boolean {
        const session = this.activeForks.get(parentId);
        if (!session || !session.childUuids.has(childUuid)) {
            return false;
        }
        session.results.set(childUuid, result);
        return true;
    }

    /**
     * Marks a child agent as deleted in the session.
     * @param {string} parentId - Parent agent ID of the session
     * @param {string} childUuid - Child agent UUID that was deleted
     * @returns {boolean} True if child was marked as deleted, false if session or child not found
     * @example
     * manager.addDeletedChild(parentId, childUuid);
     */
    public addDeletedChild(parentId: string, childUuid: string): boolean {
        const session = this.activeForks.get(parentId);
        if (!session || !session.childUuids.has(childUuid)) {
            return false;
        }
        session.deletedChildren.add(childUuid);
        return true;
    }

    /**
     * Checks if a fork session is complete.
     * A session is complete when all children have either produced results or been deleted.
     * @param {string} parentId - Parent agent ID of the session
     * @returns {boolean} True if all children have been accounted for
     * @example
     * if (manager.isSessionComplete(parentId)) {
     *   // generate final report
     * }
     */
    public isSessionComplete(parentId: string): boolean {
        const session = this.activeForks.get(parentId);
        if (!session) {
            return false;
        }

        for (const childId of session.childUuids) {
            if (!session.results.has(childId) && !session.deletedChildren.has(childId)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Generates the final report for a completed session.
     * @param {string} parentId - Parent agent ID of the session
     * @param {Map<string, AgentStateInfo>} registry - Agent registry for looking up names
     * @returns {string} The formatted final report, or empty string if session not found
     * @example
     * const report = manager.generateReport(parentId, agentRegistry);
     * console.log(report);
     */
    public generateReport(parentId: string, registry: Map<string, AgentStateInfo>): string {
        const session = this.activeForks.get(parentId);
        if (!session) {
            return '';
        }

        const successSummaries = Array.from(session.results.entries())
            .map(([uuid, text]) => {
                const name = registry.get(uuid)?.name || uuid.slice(0, 6);
                return `### Sub-agent '${name}' Finished:\n${text}`;
            });

        const deletedSummaries = Array.from(session.deletedChildren).map(uuid => {
            return `### Sub-agent ${uuid.slice(0, 6)} was deleted (Cancelled).`;
        });

        const finalReport = [...successSummaries, ...deletedSummaries].join('\n\n----------------\n\n');

        if (!finalReport.trim()) {
            return 'All sub-agents were deleted or produced no output.';
        }
        return finalReport;
    }

    /**
     * Cancels an active fork session.
     * Rejects the session's promise with the given reason and removes the session.
     * @param {string} parentId - Parent agent ID of the session to cancel
     * @param {string} reason - Reason for cancellation
     * @returns {boolean} True if session was cancelled, false if not found
     * @example
     * manager.cancelSession(parentId, 'User aborted execution');
     */
    public cancelSession(parentId: string, reason: string): boolean {
        const session = this.activeForks.get(parentId);
        if (session) {
            session.reject(new Error(reason));
            this.activeForks.delete(parentId);
            return true;
        }
        return false;
    }

    /**
     * Gets all active session parent IDs.
     * @returns {string[]} Array of parent IDs for all active sessions
     * @example
     * const activeSessions = manager.getActiveSessionIds();
     */
    public getActiveSessionIds(): string[] {
        return Array.from(this.activeForks.keys());
    }

    /**
     * Clears all active fork sessions.
     * @description This will reject all pending sessions with a 'Session manager cleared' reason.
     * Use with caution, typically during shutdown.
     * @example
     * manager.clearAllSessions();
     */
    public clearAllSessions(): void {
        for (const [parentId, session] of this.activeForks) {
            session.reject(new Error('Session manager cleared'));
        }
        this.activeForks.clear();
    }
}

// Export the interface for external use
export type { ForkSession };
