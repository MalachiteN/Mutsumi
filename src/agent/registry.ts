/**
 * @fileoverview Agent Registry - Manages the global agent state registry.
 * @module agent/registry
 */

import * as vscode from 'vscode';
import { AgentStateInfo } from '../types';
import { debugLogger } from '../debugLogger';
import { AgentFileOperations } from './fileOps';

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
        const isUpdate = this.agentRegistry.has(uuid);
        this.agentRegistry.set(uuid, agent);
        debugLogger.log(`[AgentRegistry] ${isUpdate ? 'Updated' : 'Registered'} agent: ${agent.name} (${uuid})`);
    }

    /**
     * Sets an agent with conflict detection and resolution.
     * @description Checks if an agent with the same UUID already exists with a different file URI.
     * If so, sanitizes the file (generates new UUID, clears relationships) and registers with the new UUID.
     * @param {AgentStateInfo} agent - Agent state information to store
     * @returns {Promise<string>} The UUID actually used (may be different from agent.uuid if conflict was resolved)
     * @example
     * const finalUuid = await registry.setAgentWithConflictCheck(agent);
     */
    public async setAgentWithConflictCheck(agent: AgentStateInfo): Promise<string> {
        const existing = this.agentRegistry.get(agent.uuid);
        
        // Check if there's a conflict: same UUID but different file URI
        if (existing && existing.fileUri !== agent.fileUri) {
            debugLogger.log(`[AgentRegistry] UUID conflict detected: ${agent.uuid} exists at ${existing.fileUri}, but trying to register from ${agent.fileUri}`);
            
            try {
                // Sanitize the file to get a new UUID
                const fileUri = vscode.Uri.parse(agent.fileUri);
                const { newUuid, newMetadata } = await AgentFileOperations.sanitizeAgentFile(fileUri);
                
                // Update agent info with new UUID and metadata
                agent.uuid = newUuid;
                agent.name = newMetadata.name;
                agent.parentId = null;
                agent.childIds = new Set();
                
                debugLogger.log(`[AgentRegistry] File sanitized. New UUID: ${newUuid}, Name: ${agent.name}`);
                
                // Register with new UUID
                this.agentRegistry.set(newUuid, agent);
                debugLogger.log(`[AgentRegistry] Registered sanitized agent: ${agent.name} (${newUuid})`);
                return newUuid;
            } catch (e) {
                console.error('[AgentRegistry] Failed to sanitize agent file:', e);
                // Fall back to original behavior if sanitization fails
                this.agentRegistry.set(agent.uuid, agent);
                debugLogger.log(`[AgentRegistry] Registered agent (fallback): ${agent.name} (${agent.uuid})`);
                return agent.uuid;
            }
        }
        
        // No conflict or same file URI - register normally
        const isUpdate = this.agentRegistry.has(agent.uuid);
        this.agentRegistry.set(agent.uuid, agent);
        debugLogger.log(`[AgentRegistry] ${isUpdate ? 'Updated' : 'Registered'} agent: ${agent.name} (${agent.uuid})`);
        return agent.uuid;
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
        const agent = this.agentRegistry.get(uuid);
        const deleted = this.agentRegistry.delete(uuid);
        if (deleted && agent) {
            debugLogger.log(`[AgentRegistry] Deleted agent: ${agent.name} (${uuid})`);
        }
        return deleted;
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
        const count = this.agentRegistry.size;
        this.agentRegistry.clear();
        debugLogger.log(`[AgentRegistry] Cleared all agents (${count} removed)`);
    }
}
