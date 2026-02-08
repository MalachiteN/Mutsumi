/**
 * @fileoverview Agent Registry - Manages the global agent state registry.
 * @module agent/registry
 */

import { AgentStateInfo } from '../types';

/**
 * Agent Registry - Singleton class for managing agent state information.
 * @description Provides centralized storage and retrieval of agent states,
 * supporting UUID-based lookups and file URI-based searches.
 * @class AgentRegistry
 * @example
 * const registry = AgentRegistry.getInstance();
 * registry.setAgent(uuid, agentInfo);
 * const agent = registry.getAgent(uuid);
 */
export class AgentRegistry {
    /** Singleton instance */
    private static instance: AgentRegistry;

    /** Global agent state registry (UUID -> Info) */
    private agentRegistry = new Map<string, AgentStateInfo>();

    /**
     * Private constructor to enforce singleton pattern.
     * @private
     * @constructor
     */
    private constructor() {}

    /**
     * Gets the singleton instance of AgentRegistry.
     * @static
     * @returns {AgentRegistry} The singleton instance
     * @example
     * const registry = AgentRegistry.getInstance();
     */
    public static getInstance(): AgentRegistry {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }

    /**
     * Retrieves an agent by its UUID.
     * @param {string} uuid - Agent UUID
     * @returns {AgentStateInfo | undefined} The agent state info or undefined if not found
     * @example
     * const agent = registry.getAgent('uuid-string');
     * if (agent) {
     *   console.log(agent.name);
     * }
     */
    public getAgent(uuid: string): AgentStateInfo | undefined {
        return this.agentRegistry.get(uuid);
    }

    /**
     * Sets or updates an agent in the registry.
     * @param {string} uuid - Agent UUID
     * @param {AgentStateInfo} agent - Agent state information to store
     * @example
     * registry.setAgent('uuid-string', {
     *   uuid: 'uuid-string',
     *   parentId: null,
     *   name: 'My Agent',
     *   fileUri: 'file:///path/to/agent.mtm',
     *   isWindowOpen: true,
     *   isRunning: false,
     *   isTaskFinished: false
     * });
     */
    public setAgent(uuid: string, agent: AgentStateInfo): void {
        this.agentRegistry.set(uuid, agent);
    }

    /**
     * Deletes an agent from the registry.
     * @param {string} uuid - Agent UUID to delete
     * @returns {boolean} True if the agent was deleted, false if not found
     * @example
     * const deleted = registry.deleteAgent('uuid-string');
     * if (deleted) {
     *   console.log('Agent removed');
     * }
     */
    public deleteAgent(uuid: string): boolean {
        return this.agentRegistry.delete(uuid);
    }

    /**
     * Checks if an agent exists in the registry.
     * @param {string} uuid - Agent UUID to check
     * @returns {boolean} True if the agent exists, false otherwise
     * @example
     * if (registry.hasAgent('uuid-string')) {
     *   console.log('Agent exists');
     * }
     */
    public hasAgent(uuid: string): boolean {
        return this.agentRegistry.has(uuid);
    }

    /**
     * Gets all agents in the registry.
     * @returns {AgentStateInfo[]} Array of all agent state info
     * @example
     * const agents = registry.getAllAgents();
     * agents.forEach(agent => console.log(agent.name));
     */
    public getAllAgents(): AgentStateInfo[] {
        return Array.from(this.agentRegistry.values());
    }

    /**
     * Finds an agent by its file URI.
     * @param {string} uri - File URI string to search for
     * @returns {AgentStateInfo | undefined} The matching agent or undefined if not found
     * @example
     * const agent = registry.findAgentByFileUri('file:///path/to/agent.mtm');
     */
    public findAgentByFileUri(uri: string): AgentStateInfo | undefined {
        for (const agent of this.agentRegistry.values()) {
            if (agent.fileUri === uri) {
                return agent;
            }
        }
        return undefined;
    }

    /**
     * Clears all agents from the registry.
     * @description Use with caution - this removes all registered agents.
     * @example
     * registry.clear();
     * console.log(registry.getAllAgents().length); // 0
     */
    public clear(): void {
        this.agentRegistry.clear();
    }
}
