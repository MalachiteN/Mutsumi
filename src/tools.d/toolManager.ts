/**
 * @fileoverview Tool manager for agent tools.
 * @module toolManager
 */

import { ITool, ToolContext } from './interface';
import { readFileTool } from './tools/read_file';
import { lsTool } from './tools/ls';
import { shellExecTool } from './tools/shell_exec';
import { editFileSearchReplaceTool } from './tools/edit_file_search_replace';
import { editFileFullReplaceTool } from './tools/edit_file_full_replace';
import { partiallyReadByRangeTool, partiallyReadAroundKeywordTool } from './tools/read_partial';
import { searchFileContainsKeywordTool, searchFileNameIncludesTool } from './tools/search_fs';
import { getFileSizeTool, getEnvVarTool, systemInfoTool } from './tools/system_info';
import { mkdirTool, createNewFileTool } from './tools/fs_write_ops';
import { selfForkTool, taskFinishTool, getAgentTypesTool } from './tools/agent_control';
import { projectOutlineTool } from './tools/project_outline';
import { getWarningErrorTool } from './tools/get_warning_error';
import { queryCodebaseTool } from './tools/rag';
import { AgentTypeRegistry } from '../registry/agentTypeRegistry';
import { ToolSetRegistry } from '../registry/toolSetRegistry';
import * as vscode from 'vscode';
import OpenAI from 'openai';
import {
    getCachedResult,
    setCachedResult
} from './cache';

// Re-export cache functions for convenience
export { getToolCacheSize, clearToolCache } from './cache';

/**
 * Tool set configuration for different agent types.
 * @interface ToolSetConfig
 */
export interface ToolSetConfig {
    /** Include common tools (file operations, search, etc.) */
    includeCommon?: boolean;
    /** Include task_finish tool */
    includeTaskFinish?: boolean;
    /** Additional specific tools to include */
    additionalTools?: ITool[];
    /** Specific tools to exclude from common set */
    excludeTools?: string[];
}

/**
 * A specific combination of tools for an agent instance.
 * @class ToolSet
 * @description Encapsulates a specific set of tools, allowing different agents
 * to have different tool availability without affecting global state.
 */
export class ToolSet {
    private tools = new Map<string, ITool>();

    /**
     * Creates a new ToolSet with the specified configuration.
     * @constructor
     * @param {ToolSetConfig} config - Tool set configuration
     */
    constructor(config: ToolSetConfig = {}) {
        const {
            includeCommon = true,
            includeTaskFinish = false,
            additionalTools = [],
            excludeTools = []
        } = config;

        // Add common tools
        if (includeCommon) {
            for (const tool of ToolRegistry.getCommonTools()) {
                if (!excludeTools.includes(tool.name)) {
                    this.tools.set(tool.name, tool);
                }
            }
        }

        // Add task_finish if requested
        if (includeTaskFinish) {
            this.tools.set(taskFinishTool.name, taskFinishTool);
        }

        // Add additional tools
        for (const tool of additionalTools) {
            this.tools.set(tool.name, tool);
        }
    }

    /**
     * Gets all tool definitions formatted for OpenAI API.
     * @returns {OpenAI.Chat.ChatCompletionTool[]} Array of tool definitions
     */
    getDefinitions(): OpenAI.Chat.ChatCompletionTool[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    /**
     * Executes a tool with the given arguments.
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @param {ToolContext} context - Execution context
     * @returns {Promise<string>} Tool execution result
     * @throws {Error} If tool not found or execution fails
     */
    async execute(name: string, args: any, context: ToolContext): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) {
            return `Error: Tool '${name}' is not available in this agent's tool set.`;
        }
        return await tool.execute(args, context);
    }

    /**
     * Gets the pretty print string for a tool call.
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @returns {string} Human-readable description
     */
    getPrettyPrint(name: string, args: any): string {
        const tool = this.tools.get(name);
        if (!tool) {
            return `🔧 Tool Call: ${name}`;
        }
        return tool.prettyPrint(args);
    }

    /**
     * Gets whether a tool should have its results cached.
     * @param {string} name - Tool name
     * @returns {boolean} True if the tool should be cached
     */
    getShouldCache(name: string): boolean {
        const tool = this.tools.get(name);
        if (!tool) {
            return false;
        }
        return tool.shouldCache ?? false;
    }

    /**
     * Gets the rendering configuration for a tool.
     * @param {string} name - Tool name
     * @returns {Object | undefined} Rendering configuration
     */
    getRenderingConfig(name: string): { argsToCodeBlock?: string[]; codeBlockFilePaths?: (string | undefined)[] } | undefined {
        const tool = this.tools.get(name);
        if (!tool) return undefined;
        return {
            argsToCodeBlock: tool.argsToCodeBlock,
            codeBlockFilePaths: tool.codeBlockFilePaths
        };
    }

    /**
     * Checks if a tool is available in this tool set.
     * @param {string} name - Tool name
     * @returns {boolean} True if tool is available
     */
    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Gets all available tool names.
     * @returns {string[]} Array of tool names
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Adds a tool to this tool set dynamically.
     * Used for special cases like injecting task_finish for sub-agents.
     * @param {ITool} tool - The tool to add
     */
    addTool(tool: ITool): void {
        this.tools.set(tool.name, tool);
    }
}

/**
 * Global tool registry for managing all available tools.
 * @class ToolRegistry
 * @description Maintains the global registry of all tools. Used by ToolSet
 * to build specific tool combinations for agents.
 */
export class ToolRegistry {
    private static commonTools: ITool[] = [];
    private static toolNameMap: Map<string, ITool> = new Map();
    private static initialized = false;

    /**
     * Mapping from config tool names to actual tool exports.
     * This ensures consistent naming between config and implementation.
     */
    private static readonly TOOL_NAME_MAPPING: Record<string, ITool> = {
        'read_file': readFileTool,
        'ls': lsTool,
        'shell': shellExecTool,
        'edit_file_full_replace': editFileFullReplaceTool,
        'edit_file_search_replace': editFileSearchReplaceTool,
        'read_partial_by_range': partiallyReadByRangeTool,
        'read_partial_around_keyword': partiallyReadAroundKeywordTool,
        'search_file_contains_keyword': searchFileContainsKeywordTool,
        'search_file_name_includes': searchFileNameIncludesTool,
        'get_file_size': getFileSizeTool,
        'get_env_var': getEnvVarTool,
        'system_info': systemInfoTool,
        'mkdir': mkdirTool,
        'create_file': createNewFileTool,
        'project_outline': projectOutlineTool,
        'get_warning_error': getWarningErrorTool,
        'self_fork': selfForkTool,
        'task_finish': taskFinishTool,
        'get_agent_types': getAgentTypesTool,
        'query_codebase': queryCodebaseTool
    };

    /**
     * Initializes the global tool registry.
     * @description Should be called once during extension activation.
     */
    static initialize(): void {
        if (this.initialized) return;

        // Check if embedding endpoint is configured
        const config = vscode.workspace.getConfiguration('mutsumi');
        const embeddingEndpoint = config.get<string>('embeddingEndpoint') ?? '';
        const isRagEnabled = embeddingEndpoint.trim() !== '';

        // Register all common tools
        this.commonTools = [
            readFileTool,
            lsTool,
            shellExecTool,
            editFileFullReplaceTool,
            editFileSearchReplaceTool,
            partiallyReadByRangeTool,
            partiallyReadAroundKeywordTool,
            searchFileContainsKeywordTool,
            searchFileNameIncludesTool,
            getFileSizeTool,
            getEnvVarTool,
            systemInfoTool,
            mkdirTool,
            createNewFileTool,
            projectOutlineTool,
            getWarningErrorTool,
            selfForkTool,
            getAgentTypesTool
        ];

        // Only add RAG tool if embedding endpoint is configured
        if (isRagEnabled) {
            this.commonTools.push(queryCodebaseTool);
        }

        // Build the tool name map for quick lookup
        this.toolNameMap.clear();
        for (const [name, tool] of Object.entries(this.TOOL_NAME_MAPPING)) {
            this.toolNameMap.set(name, tool);
        }

        this.initialized = true;
    }

    /**
     * Gets all common tools.
     * @returns {ITool[]} Array of common tools
     */
    static getCommonTools(): ITool[] {
        if (!this.initialized) {
            this.initialize();
        }
        return [...this.commonTools];
    }

    /**
     * Gets the task_finish tool.
     * @returns {ITool} The task_finish tool
     */
    static getTaskFinishTool(): ITool {
        return taskFinishTool;
    }

    /**
     * Gets a tool by its config name.
     * @param {string} name - Tool name as used in config (e.g., 'read_file')
     * @returns {ITool | undefined} The tool if found, undefined otherwise
     */
    static getToolByName(name: string): ITool | undefined {
        if (!this.initialized) {
            this.initialize();
        }
        return this.toolNameMap.get(name);
    }

    /**
     * Builds a tool set from an array of tool names.
     * Only includes tools that are registered and available.
     * @param {string[]} names - Array of tool names as used in config
     * @returns {ITool[]} Array of resolved tools (excludes unavailable tools)
     */
    static buildToolSetFromNames(names: string[]): ITool[] {
        if (!this.initialized) {
            this.initialize();
        }

        const tools: ITool[] = [];
        for (const name of names) {
            const tool = this.toolNameMap.get(name);
            if (tool) {
                tools.push(tool);
            }
        }
        return tools;
    }

    /**
     * Gets all registered tool names.
     * @returns {string[]} Array of all registered tool names
     */
    static getRegisteredToolNames(): string[] {
        if (!this.initialized) {
            this.initialize();
        }
        return Array.from(this.toolNameMap.keys());
    }
}

/**
 * Global ToolManager for user/ContextManagement control plane operations.
 * Provides global tool access, completion, pre-execution, and rendering support.
 */
export class ToolManager {
    /** Singleton instance */
    private static instance: ToolManager;
    private toolSet: ToolSet;

    /**
     * Gets the singleton instance of ToolManager.
     * @static
     * @returns {ToolManager} The singleton instance
     */
    public static getInstance(): ToolManager {
        if (!ToolManager.instance) {
            ToolManager.instance = new ToolManager();
        }
        return ToolManager.instance;
    }

    /**
     * Creates a new ToolManager instance.
     * @constructor
     */
    constructor() {
        if (!ToolManager.instance) {
            ToolManager.instance = this;
        }
        // Default tool set includes all common tools + task_finish
        this.toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: true
        });
    }

    /**
     * Gets tool definitions formatted for OpenAI API.
     * @param {boolean} isSubAgent - True for non-root/child sessions (includes task_finish)
     * @returns {OpenAI.Chat.ChatCompletionTool[]} Array of tool definitions
     */
    public getToolsDefinitions(isSubAgent: boolean): OpenAI.Chat.ChatCompletionTool[] {
        // Create appropriate tool set based on agent type
        const toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: isSubAgent
        });
        return toolSet.getDefinitions();
    }

    /**
     * Executes a tool with the given arguments and context.
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @param {ToolContext} context - Execution context
     * @param {boolean} isSubAgent - True for non-root/child sessions (includes task_finish)
     * @returns {Promise<string>} Tool execution result
     */
    public async executeTool(
        name: string,
        args: any,
        context: ToolContext,
        isSubAgent: boolean
    ): Promise<string> {
        const toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: isSubAgent
        });

        const shouldCache = toolSet.getShouldCache(name);

        if (shouldCache) {
            const cached = getCachedResult(name, args);
            if (cached !== undefined) {
                return cached;
            }
        }

        const result = await toolSet.execute(name, args, context);

        if (shouldCache) {
            setCachedResult(name, args, result);
        }

        return result;
    }

    /**
     * Gets the pretty print string for a tool call.
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @param {boolean} isSubAgent - True for non-root/child sessions
     * @returns {string} Human-readable description
     */
    public getPrettyPrint(name: string, args: any, isSubAgent: boolean): string {
        const toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: isSubAgent
        });
        return toolSet.getPrettyPrint(name, args);
    }

    /**
     * Gets the rendering configuration for a tool.
     * @param {string} name - Tool name
     * @param {boolean} isSubAgent - True for non-root/child sessions
     * @returns {Object | undefined} Rendering configuration
     */
    public getToolRenderingConfig(name: string, isSubAgent: boolean): { argsToCodeBlock?: string[]; codeBlockFilePaths?: (string | undefined)[] } | undefined {
        const toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: isSubAgent
        });
        return toolSet.getRenderingConfig(name);
    }
}

/**
 * Creates a tool set for an agent based on its agentType configuration.
 * Resolves toolSets from AgentTypeRegistry and adds task_finish for non-root agents.
 * 
 * @param {string} agentType - The agent type identifier
 * @param {string} [uuid] - Agent UUID for error messages
 * @param {string | null} [parentAgentId] - Parent agent ID if this is a non-root agent
 * @returns {ToolSet} Configured tool set
 * @throws {Error} If agentType is invalid
 */
export function createToolSetForAgent(
    agentType: string,
    uuid?: string,
    parentAgentId?: string | null
): ToolSet {
    const agentTypeConfig = AgentTypeRegistry.getInstance().getAgentType(agentType);
    if (!agentTypeConfig) {
        throw new Error(
            `Unknown agent type '${agentType}' for agent ${uuid || 'unknown'}. ` +
            `Available types: ${AgentTypeRegistry.getInstance().getAllTypes().join(', ')}`
        );
    }

    // Get combined tools from all specified tool sets
    const tools = ToolSetRegistry.getInstance().getCombinedToolSet(agentTypeConfig.toolSets);
    
    // Create ToolSet with specific tools
    const toolSet = new ToolSet({
        includeCommon: false,
        includeTaskFinish: false,
        additionalTools: tools
    });
    
    // Sub-agents get task_finish tool
    if (parentAgentId) {
        const taskFinishTool = ToolRegistry.getTaskFinishTool();
        toolSet.addTool(taskFinishTool);
    }
    
    return toolSet;
}

/**
 * Creates an empty tool set for special purposes (e.g., title generation).
 * @returns {ToolSet} Empty tool set
 */
export function createEmptyToolSet(): ToolSet {
    return new ToolSet({
        includeCommon: false,
        includeTaskFinish: false
    });
}
