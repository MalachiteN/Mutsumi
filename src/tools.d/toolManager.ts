/**
 * @fileoverview Tool manager for registering and executing agent tools.
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
import { selfForkTool, taskFinishTool, getAvailableModelsTool } from './tools/agent_control';
import { projectOutlineTool } from './tools/project_outline';
import { getWarningErrorTool } from './tools/get_warning_error';
import { queryCodebaseTool } from './tools/rag';
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
}

/**
 * Global tool registry for managing all available tools.
 * @class ToolRegistry
 * @description Maintains the global registry of all tools. Used by ToolSet
 * to build specific tool combinations for agents.
 */
export class ToolRegistry {
    private static commonTools: ITool[] = [];
    private static initialized = false;

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
            getAvailableModelsTool
        ];

        // Only add RAG tool if embedding endpoint is configured
        if (isRagEnabled) {
            this.commonTools.push(queryCodebaseTool);
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
}

/**
 * Global ToolManager for operations not tied to any specific Agent.
 * @class ToolManager
 * @description
 * This singleton provides tool execution and metadata access for operations
 * that are not associated with any specific Agent instance. It is used by:
 * - Context pre-execution (templateEngine, context building)
 * - Notebook serialization (pretty-printing tool calls)
 * - Code completion (listing available tools)
 *
 * Unlike ToolSet which is per-Agent and configurable, ToolManager provides
 * a global, shared interface to all tools. It also manages the global tool
 * result cache, ensuring cache hits across all contexts (Agent execution
 * and pre-execution alike).
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
     * @param {boolean} isSubAgent - Whether requesting for a sub-agent
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
     * Results are automatically cached if the tool has shouldCache enabled.
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @param {ToolContext} context - Execution context
     * @param {boolean} isSubAgent - Whether this is for a sub-agent
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
     * @param {boolean} isSubAgent - Whether this is for a sub-agent
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
     * @param {boolean} isSubAgent - Whether this is for a sub-agent
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

// Export factory functions for common tool set configurations

/**
 * Creates a tool set for main agents (no task_finish).
 * @returns {ToolSet} Tool set for main agents
 */
export function createMainAgentToolSet(): ToolSet {
    return new ToolSet({
        includeCommon: true,
        includeTaskFinish: false
    });
}

/**
 * Creates a tool set for sub-agents (includes task_finish).
 * @returns {ToolSet} Tool set for sub-agents
 */
export function createSubAgentToolSet(): ToolSet {
    return new ToolSet({
        includeCommon: true,
        includeTaskFinish: true
    });
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
