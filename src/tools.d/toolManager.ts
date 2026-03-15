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
import { SkillManager } from '../contextManagement/skillManager';

import OpenAI from 'openai';

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
 * Legacy ToolManager for backward compatibility.
 * @class ToolManager
 * @deprecated Use ToolSet for per-agent tool combinations.
 */
export class ToolManager {
    /** Singleton instance */
    private static instance: ToolManager;
    private toolSet: ToolSet;

    /**
     * Gets the singleton instance of ToolManager.
     * @static
     * @returns {ToolManager} The singleton instance
     * @deprecated Use ToolSet directly for new code.
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
     * @deprecated Use ToolSet directly.
     */
    constructor() {
        if (!ToolManager.instance) {
            ToolManager.instance = this;
        }
        // Default tool set for sub-agents (includes task_finish)
        this.toolSet = new ToolSet({
            includeCommon: true,
            includeTaskFinish: true
        });
        // Fire and forget skill loading
        this.loadSkills().catch(err => console.error('Failed to load skills:', err));
    }

    /**
     * Loads dynamic skills from the workspace.
     * @returns {Promise<void>}
     */
    public async loadSkills(): Promise<void> {
        await SkillManager.getInstance().loadSkills();
    }

    /**
     * Gets tool definitions formatted for OpenAI API.
     * @description Legacy method for backward compatibility.
     * @param {boolean} isSubAgent - Whether requesting for a sub-agent
     * @returns {OpenAI.Chat.ChatCompletionTool[]} Array of tool definitions
     * @deprecated Use ToolSet.getDefinitions() instead.
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
     * @deprecated Use ToolSet.execute() instead.
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
        return await toolSet.execute(name, args, context);
    }

    /**
     * Gets the pretty print string for a tool call.
     * @deprecated Use ToolSet.getPrettyPrint() instead.
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
     * @deprecated Use ToolSet.getRenderingConfig() instead.
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
