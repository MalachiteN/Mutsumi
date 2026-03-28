/**
 * @fileoverview Agent Type Registry for managing agent type configurations.
 * @module registry/agentTypeRegistry
 */

import {
    AgentTypeConfig,
    AgentTypeConfigMap
} from '../config/interfaces';
import { DEFAULT_MUTSUMI_CONFIG } from '../config/types';

/**
 * Stores agent type configurations, validates toolSets/child types, provides entry type queries.
 * Initialize during extension activation with config from .mutsumi/config.json.
 */
export class AgentTypeRegistry {
    private static instance: AgentTypeRegistry | null = null;
    private agentTypes: Map<string, AgentTypeConfig> = new Map();
    private toolSetNames: Set<string> = new Set();
    private initialized = false;

    /**
     * Gets the singleton instance.
     * @returns {AgentTypeRegistry} The singleton instance
     */
    static getInstance(): AgentTypeRegistry {
        if (!AgentTypeRegistry.instance) {
            AgentTypeRegistry.instance = new AgentTypeRegistry();
        }
        return AgentTypeRegistry.instance;
    }

    /**
     * Private constructor to enforce singleton pattern.
     */
    private constructor() {}

    /**
     * Initializes the registry with agent type configurations.
     * 
     * This should be called once during extension activation after
     * the configuration has been loaded. It validates all references
     * to ensure consistency.
     * 
     * @param {AgentTypeConfigMap} config - Agent type configuration
     * @param {string[]} toolSetNames - Available tool set names for validation
     * @throws {Error} If validation fails
     */
    initialize(config: AgentTypeConfigMap, toolSetNames: string[]): void {
        if (this.initialized) {
            return;
        }

        // Clear existing types
        this.agentTypes.clear();
        this.toolSetNames = new Set(toolSetNames);

        // First pass: collect all type names for child type validation
        const allTypeNames = new Set(Object.keys(config));

        // Second pass: validate and store each agent type
        for (const [name, typeConfig] of Object.entries(config)) {
            this.validateAgentType(name, typeConfig, allTypeNames);
            this.agentTypes.set(name, { ...typeConfig }); // Clone
        }

        this.initialized = true;
    }

    /**
     * Validates an agent type configuration.
     * @private
     * @param {string} name - The agent type name
     * @param {AgentTypeConfig} config - The configuration to validate
     * @param {Set<string>} allTypeNames - Set of all defined type names
     * @throws {Error} If validation fails
     */
    private validateAgentType(
        name: string,
        config: AgentTypeConfig,
        allTypeNames: Set<string>
    ): void {
        // Validate tool set references (must be an array)
        if (!Array.isArray(config.toolSets)) {
            throw new Error(
                `Agent type '${name}' must have toolSets as an array`
            );
        }
        for (const toolSetName of config.toolSets) {
            if (!this.toolSetNames.has(toolSetName)) {
                throw new Error(
                    `Agent type '${name}' references unknown tool set: '${toolSetName}'`
                );
            }
        }

        // Validate allowedChildTypes
        for (const childType of config.allowedChildTypes) {
            if (!allTypeNames.has(childType)) {
                throw new Error(
                    `Agent type '${name}' references unknown child type: '${childType}'`
                );
            }
        }
    }

    /**
     * Gets an agent type configuration by name.
     * @param {string} name - The agent type name
     * @returns {AgentTypeConfig | undefined} The configuration or undefined if not found
     */
    getAgentType(name: string): AgentTypeConfig | undefined {
        this.ensureInitialized();
        return this.agentTypes.get(name);
    }

    /**
     * Lists all agent type names that can be created as entry agents.
     * @returns {string[]} Array of entry type names
     */
    listEntryTypes(): string[] {
        this.ensureInitialized();
        const entries: string[] = [];
        for (const [name, config] of this.agentTypes) {
            if (config.isEntry) {
                entries.push(name);
            }
        }
        return entries;
    }

    /**
     * Checks if a child type is valid for a given parent type.
     * @param {string} parentType - The parent agent type name
     * @param {string} childType - The child agent type name to validate
     * @returns {boolean} True if the child type is allowed
     */
    isValidChildType(parentType: string, childType: string): boolean {
        this.ensureInitialized();
        const parent = this.agentTypes.get(parentType);
        if (!parent) {
            return false;
        }
        return parent.allowedChildTypes.includes(childType);
    }

    /**
     * Gets all registered agent type names.
     * @returns {string[]} Array of all agent type names
     */
    getAllTypes(): string[] {
        this.ensureInitialized();
        return Array.from(this.agentTypes.keys());
    }

    /**
     * Checks if an agent type exists.
     * @param {string} name - The agent type name to check
     * @returns {boolean} True if the type exists
     */
    hasAgentType(name: string): boolean {
        this.ensureInitialized();
        return this.agentTypes.has(name);
    }

    /**
     * Gets the tool set names for an agent type.
     * @param {string} name - The agent type name
     * @returns {string[] | undefined} The tool set names or undefined
     */
    getToolSetNames(name: string): string[] | undefined {
        this.ensureInitialized();
        return this.agentTypes.get(name)?.toolSets;
    }

    /**
     * Ensures the registry has been initialized.
     * @private
     * @throws {Error} If not initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                'AgentTypeRegistry not initialized. Call initialize() first.'
            );
        }
    }

    /**
     * Resets the registry (primarily for testing).
     */
    reset(): void {
        this.agentTypes.clear();
        this.toolSetNames.clear();
        this.initialized = false;
    }
}
