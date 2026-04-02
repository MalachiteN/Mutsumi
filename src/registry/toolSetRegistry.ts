/**
 * @fileoverview ToolSet Registry for managing named tool set configurations.
 * @module registry/toolSetRegistry
 */

import * as vscode from 'vscode';
import { ITool } from '../tools.d/interface';
import { ToolRegistry } from '../tools.d/toolManager';
import { ToolSetsConfig, ToolSetDefinition } from '../config/interfaces';
import { DEFAULT_MUTSUMI_CONFIG } from '../config/types';

/**
 * ToolSetRegistry manages named collections of tools.
 * 
 * This registry is responsible for:
 * - Storing tool set configurations (name -> tool name array)
 * - Resolving tool names to actual ITool instances
 * - Validating that all referenced tools exist in ToolRegistry
 * 
 * It is a singleton that should be initialized during extension activation
 * with configuration loaded from .mutsumi/config.json.
 * 
 * @example
 * ```typescript
 * const registry = ToolSetRegistry.getInstance();
 * registry.initialize(config.toolSets);
 * const tools = registry.getToolSet('read');
 * ```
 */
export class ToolSetRegistry {
    private static instance: ToolSetRegistry | null = null;
    private toolSets: Map<string, string[]> = new Map();
    private initialized = false;

    /**
     * Gets the singleton instance of ToolSetRegistry.
     * @returns {ToolSetRegistry} The singleton instance
     */
    static getInstance(): ToolSetRegistry {
        if (!ToolSetRegistry.instance) {
            ToolSetRegistry.instance = new ToolSetRegistry();
        }
        return ToolSetRegistry.instance;
    }

    /**
     * Private constructor to enforce singleton pattern.
     */
    private constructor() {}

    /**
     * Initializes the registry with tool set configurations.
     * 
     * This should be called once during extension activation after
     * the configuration has been loaded.
     * 
     * The RAG tool 'query_codebase' is handled specially:
     * - If embedding endpoint is NOT configured, it's removed from all tool sets
     * - This allows the same config to work with or without RAG enabled
     * 
     * @param {ToolSetsConfig} config - Tool set configuration mapping names to tool name arrays
     * @throws {Error} If a tool set references a non-existent tool
     */
    initialize(config: ToolSetsConfig): void {
        if (this.initialized) {
            return;
        }

        // Clear existing tool sets
        this.toolSets.clear();

        // Check if RAG is enabled (embedding endpoint configured)
        const vscodeConfig = vscode.workspace.getConfiguration('mutsumi');
        const embeddingEndpoint = vscodeConfig.get<string>('embeddingEndpoint') ?? '';
        const isRagEnabled = embeddingEndpoint.trim() !== '';

        // Process each tool set
        for (const [name, toolNames] of Object.entries(config)) {
            // Clone and conditionally filter tool names
            let processedToolNames = [...toolNames];
            
            // Remove query_codebase if RAG is not enabled
            if (!isRagEnabled) {
                const ragToolIndex = processedToolNames.indexOf('query_codebase');
                if (ragToolIndex !== -1) {
                    processedToolNames.splice(ragToolIndex, 1);
                }
            }

            this.validateToolNames(processedToolNames, name);
            this.toolSets.set(name, processedToolNames);
        }

        this.initialized = true;
    }

    /**
     * Validates that all tool names in a list exist in the ToolRegistry.
     * 
     * @private
     * @param {string[]} toolNames - Array of tool names to validate
     * @param {string} toolSetName - Name of the tool set (for error messages)
     * @throws {Error} If any tool name is not registered
     */
    private validateToolNames(toolNames: string[], toolSetName: string): void {
        const commonTools = ToolRegistry.getCommonTools();
        const taskFinishTool = ToolRegistry.getTaskFinishTool();
        
        // Build set of all available tool names
        const availableTools = new Set<string>(
            commonTools.map(t => t.name)
        );
        availableTools.add(taskFinishTool.name);

        // Validate each tool name
        for (const toolName of toolNames) {
            if (!availableTools.has(toolName)) {
                throw new Error(
                    `Tool set '${toolSetName}' references unknown tool: '${toolName}'`
                );
            }
        }
    }

    /**
     * Gets a tool set by name, returning the array of ITool instances.
     * 
     * @param {string} name - The tool set name (e.g., 'read', 'deliver', 'dispatch')
     * @returns {ITool[]} Array of ITool instances for the named tool set
     * @throws {Error} If the tool set does not exist
     */
    getToolSet(name: string): ITool[] {
        this.ensureInitialized();

        const toolNames = this.toolSets.get(name);
        if (!toolNames) {
            throw new Error(`Tool set '${name}' not found`);
        }

        return this.resolveTools(toolNames);
    }

    /**
     * Gets combined tools from multiple tool sets, with duplicates removed.
     * Tools from later tool sets take precedence if there are duplicates (though tool names should be unique).
     * 
     * @param {string[]} names - Array of tool set names to combine
     * @returns {ITool[]} Combined array of ITool instances with duplicates removed
     * @throws {Error} If any tool set does not exist
     */
    getCombinedToolSet(names: string[]): ITool[] {
        this.ensureInitialized();

        const seenTools = new Map<string, ITool>();
        
        for (const name of names) {
            const tools = this.getToolSet(name);
            for (const tool of tools) {
                // Later tool sets overwrite earlier ones (though names should be unique)
                seenTools.set(tool.name, tool);
            }
        }

        return Array.from(seenTools.values());
    }

    /**
     * Checks if a tool set with the given name exists.
     * 
     * @param {string} name - The tool set name to check
     * @returns {boolean} True if the tool set exists
     */
    hasToolSet(name: string): boolean {
        this.ensureInitialized();
        return this.toolSets.has(name);
    }

    /**
     * Gets all registered tool set names.
     * 
     * @returns {string[]} Array of all tool set names
     */
    getAllToolSetNames(): string[] {
        this.ensureInitialized();
        return Array.from(this.toolSets.keys());
    }

    /**
     * Resolves an array of tool names to ITool instances.
     * 
     * @private
     * @param {string[]} toolNames - Array of tool names to resolve
     * @returns {ITool[]} Array of resolved ITool instances
     */
    private resolveTools(toolNames: string[]): ITool[] {
        const commonTools = ToolRegistry.getCommonTools();
        const taskFinishTool = ToolRegistry.getTaskFinishTool();
        
        // Build lookup map
        const toolMap = new Map<string, ITool>();
        for (const tool of commonTools) {
            toolMap.set(tool.name, tool);
        }
        toolMap.set(taskFinishTool.name, taskFinishTool);

        // Resolve names to tools
        return toolNames.map(name => {
            const tool = toolMap.get(name);
            if (!tool) {
                throw new Error(`Tool '${name}' not found in registry`);
            }
            return tool;
        });
    }

    /**
     * Ensures the registry has been initialized.
     * 
     * @private
     * @throws {Error} If not initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                'ToolSetRegistry not initialized. Call initialize() first.'
            );
        }
    }

    /**
     * Resets the registry (primarily for testing).
     */
    reset(): void {
        this.toolSets.clear();
        this.initialized = false;
    }
}
