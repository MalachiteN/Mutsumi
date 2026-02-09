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
     * Computes and returns nodes for TreeView display based on visibility.
     * @static
     * @param {Map<string, AgentStateInfo>} registry - Agent registry map
     * @returns {AgentStateInfo[]} Array of agent nodes to display
     * @description 
     * 1. Finds all agents that are currently "Window Open".
     * 2. For each open agent, finds its root ancestor.
     * 3. From these roots, traverses down to collect the full tree structure.
     * 4. Returns all agents part of these trees.
     * 5. Ensures any detached visible agents are also included.
     */
    public static getAgentTreeNodes(
        registry: Map<string, AgentStateInfo>
    ): AgentStateInfo[] {
        const nodes = new Set<AgentStateInfo>();
        const rootsToDisplay = new Set<string>();
        const visibleAgents = new Set<AgentStateInfo>();

        // 1. Find roots of all visible agents
        for (const agent of registry.values()) {
            if (agent.isWindowOpen) {
                visibleAgents.add(agent);
                const rootId = this.getRootId(agent.uuid, registry);
                rootsToDisplay.add(rootId);
            }
        }

        // 2. Helper to traverse down from a node
        const collectTree = (uuid: string) => {
            const agent = registry.get(uuid);
            if (!agent) return;
            
            if (nodes.has(agent)) return; // Already collected
            nodes.add(agent);

            if (agent.childIds) {
                for (const childId of agent.childIds) {
                    collectTree(childId);
                }
            }
        };

        // 3. Collect all trees starting from identified roots
        for (const rootId of rootsToDisplay) {
            collectTree(rootId);
        }

        // 4. Fallback: Ensure all visible agents are included
        // This handles cases where parent->child link is missing (data inconsistency)
        // preventing traverse down, but child is visible and should be shown.
        for (const agent of visibleAgents) {
            if (!nodes.has(agent)) {
                nodes.add(agent);
                
                // Also try to ensure its path to root is included to maintain structure
                // even if the top-down traversal missed it.
                let current = agent;
                const pathVisited = new Set<string>();
                pathVisited.add(current.uuid);
                
                while (current.parentId) {
                    if (pathVisited.has(current.parentId)) break; // Cycle check
                    pathVisited.add(current.parentId);

                    const parent = registry.get(current.parentId);
                    if (parent) {
                        if (!nodes.has(parent)) {
                            nodes.add(parent);
                        }
                        current = parent;
                    } else {
                        break;
                    }
                }
            }
        }

        return Array.from(nodes);
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
