/**
 * @fileoverview Tree structure utility functions for agent management.
 * @module agent/treeUtils
 * @description Pure functions for tree operations on agent registry.
 * All methods are static and receive registry as parameter - no global state dependency.
 */

import { AgentStateInfo, AgentRuntimeStatus } from '../types';

/**
 * Utility class for agent tree structure operations.
 * @class AgentTreeUtils
 * @description Provides pure static methods for traversing and analyzing agent trees.
 * All methods are stateless and operate on the provided registry.
 */
export class AgentTreeUtils {
    /**
     * Gets the root agent ID of a tree by traversing parent pointers.
     * @static
     * @param {string} uuid - Agent UUID to find root for
     * @param {Map<string, AgentStateInfo>} registry - Agent registry map
     * @returns {string} The root agent UUID
     * @description Traverses parent pointers upward until reaching a node with no parent
     * or detecting a circular reference. Returns the root node ID.
     * @example
     * const rootId = AgentTreeUtils.getRootId('child-uuid', registry);
     */
    public static getRootId(
        uuid: string,
        registry: Map<string, AgentStateInfo>
    ): string {
        const visited = new Set<string>();
        let current = uuid;

        while (true) {
            if (visited.has(current)) {
                // Circular reference detected, break the loop
                return current;
            }
            visited.add(current);

            const agent = registry.get(current);
            if (!agent || !agent.parentId) {
                return current;
            }
            current = agent.parentId;
        }
    }

    /**
     * Checks if any agent in the tree has an open window.
     * @static
     * @param {string} rootId - Root agent UUID of the tree
     * @param {Map<string, AgentStateInfo>} registry - Agent registry map
     * @returns {boolean} True if any window in the tree is open
     * @description Recursively traverses the tree starting from rootId and checks
     * if any agent has isWindowOpen set to true.
     * @example
     * const hasOpenWindow = AgentTreeUtils.hasAnyWindowOpenInTree('root-uuid', registry);
     */
    public static hasAnyWindowOpenInTree(
        rootId: string,
        registry: Map<string, AgentStateInfo>
    ): boolean {
        const visited = new Set<string>();

        const checkNode = (uuid: string): boolean => {
            if (visited.has(uuid)) {
                return false;
            }
            visited.add(uuid);

            const agent = registry.get(uuid);
            if (!agent) {
                return false;
            }

            if (agent.isWindowOpen) {
                return true;
            }

            // Check children
            if (agent.childIds) {
                for (const childId of agent.childIds) {
                    if (checkNode(childId)) {
                        return true;
                    }
                }
            }

            return false;
        };

        return checkNode(rootId);
    }

    /**
     * Computes and returns nodes for TreeView display.
     * @static
     * @param {Map<string, AgentStateInfo>} registry - Agent registry map
     * @returns {AgentStateInfo[]} Array of agent nodes to display
     * @description Shows the entire tree if any node in the tree has an open window.
     * Only hides the tree when all nodes' windows are closed.
     * First pass finds all root IDs with at least one open window in their tree.
     * Second pass includes all agents whose root has an open window.
     * @example
     * const nodes = AgentTreeUtils.getAgentTreeNodes(registry);
     * // Returns all agents in trees where at least one window is open
     */
    public static getAgentTreeNodes(
        registry: Map<string, AgentStateInfo>
    ): AgentStateInfo[] {
        const nodes: AgentStateInfo[] = [];
        const rootIdsWithOpenWindow = new Set<string>();

        // First pass: find all root IDs that have at least one window open in their tree
        for (const agent of registry.values()) {
            if (agent.isWindowOpen) {
                const rootId = this.getRootId(agent.uuid, registry);
                rootIdsWithOpenWindow.add(rootId);
            }
        }

        // Second pass: include all agents whose root has an open window
        for (const agent of registry.values()) {
            const rootId = this.getRootId(agent.uuid, registry);
            if (rootIdsWithOpenWindow.has(rootId)) {
                nodes.push(agent);
            }
        }

        return nodes;
    }

    /**
     * Computes the runtime status of an agent.
     * @static
     * @param {AgentStateInfo} agent - The agent state info
     * @returns {AgentRuntimeStatus} The computed runtime status
     * @description Determines status based on running state, completion, and parent relationship:
     * - 'running': if agent.isRunning is true
     * - 'finished': if agent.isTaskFinished is true
     * - 'pending': if agent has a parentId but not running/finished
     * - 'standby': if no parent and not running/finished
     * @example
     * const status = AgentTreeUtils.computeStatus(agent);
     * // Returns 'running', 'finished', 'pending', or 'standby'
     */
    public static computeStatus(agent: AgentStateInfo): AgentRuntimeStatus {
        if (agent.isRunning) {
            return 'running';
        }
        if (agent.isTaskFinished) {
            return 'finished';
        }
        if (agent.parentId) {
            return 'pending';
        }
        return 'standby';
    }
}
