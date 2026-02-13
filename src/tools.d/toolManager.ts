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
import { gitCmdTool } from './tools/git_cmd';
import { selfForkTool, taskFinishTool, getAvailableModelsTool } from './tools/agent_control';
import { projectOutlineTool } from './tools/project_outline';
import { getWarningErrorTool } from './tools/get_warning_error';
import { SkillManager } from '../contextManagement/skillManager';

import OpenAI from 'openai';

/**
 * Manages tool registration and execution for agents.
 * @description Maintains separate tool registries for common tools, main-agent-only tools,
 * and sub-agent-only tools. Provides methods to retrieve tool definitions and execute tools
 * with proper access control.
 * @class ToolManager
 * @example
 * const toolManager = new ToolManager();
 * await toolManager.loadSkills();
 * const definitions = toolManager.getToolsDefinitions(false);
 * const result = await toolManager.executeTool('read_file', args, context, false);
 */
export class ToolManager {
    /** Registry of tools available to all agents */
    private commonTools = new Map<string, ITool>();
    /** Registry of tools only available to main agents */
    private mainOnlyTools = new Map<string, ITool>();
    /** Registry of tools only available to sub-agents */
    private subOnlyTools = new Map<string, ITool>();

    /** Singleton instance */
    private static instance: ToolManager;

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
     * Creates a new ToolManager instance and registers all tools.
     * @description Initializes the tool registries and registers all built-in tools.
     * If this is the first instance, sets it as the singleton.
     * @constructor
     */
    constructor() {
        if (!ToolManager.instance) {
            ToolManager.instance = this;
        }
        this.registerAllTools();
        // Fire and forget skill loading
        this.loadSkills().catch(err => console.error('Failed to load skills:', err));
    }

    /**
     * Registers all built-in tools to their respective registries.
     * @private
     */
    private registerAllTools(): void {
        // Common Tools
        this.registerCommon(readFileTool);
        this.registerCommon(lsTool);
        this.registerCommon(shellExecTool);
        this.registerCommon(editFileFullReplaceTool);
        this.registerCommon(editFileSearchReplaceTool);
        
        this.registerCommon(partiallyReadByRangeTool);
        this.registerCommon(partiallyReadAroundKeywordTool);
        
        this.registerCommon(searchFileContainsKeywordTool);
        this.registerCommon(searchFileNameIncludesTool);
        
        this.registerCommon(getFileSizeTool);
        this.registerCommon(getEnvVarTool);
        this.registerCommon(systemInfoTool);
        
        this.registerCommon(mkdirTool);
        this.registerCommon(createNewFileTool);

        this.registerCommon(gitCmdTool);
        this.registerCommon(projectOutlineTool);
        this.registerCommon(getWarningErrorTool);

        this.registerCommon(selfForkTool);
        this.registerCommon(getAvailableModelsTool);

        // Sub Agent Only Tools
        this.registerSub(taskFinishTool);
    }

    /**
     * Registers a tool as common (available to all agents).
     * @private
     * @param {ITool} tool - Tool implementation to register
     */
    private registerCommon(tool: ITool): void { 
        this.commonTools.set(tool.name, tool); 
    }

    /**
     * Registers a tool as main-agent-only.
     * @private
     * @param {ITool} tool - Tool implementation to register
     */
    private registerMain(tool: ITool): void { 
        this.mainOnlyTools.set(tool.name, tool); 
    }

    /**
     * Registers a tool as sub-agent-only.
     * @private
     * @param {ITool} tool - Tool implementation to register
     */
    private registerSub(tool: ITool): void { 
        this.subOnlyTools.set(tool.name, tool); 
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
     * @description Returns tool definitions filtered by agent type.
     * Main agents get common + main-only tools + skills, sub-agents get common + sub-only tools + skills.
     * @param {boolean} isSubAgent - Whether requesting for a sub-agent
     * @returns {OpenAI.Chat.ChatCompletionTool[]} Array of tool definitions
     * @example
     * const tools = toolManager.getToolsDefinitions(false);
     * // Returns definitions for main agent
     */
    public getToolsDefinitions(isSubAgent: boolean): OpenAI.Chat.ChatCompletionTool[] {
        const skillTools = SkillManager.getInstance().getTools();
        const tools: ITool[] = [
            ...this.commonTools.values(),
            ...(isSubAgent ? this.subOnlyTools.values() : this.mainOnlyTools.values()),
            ...skillTools
        ];
        return tools.map(t => t.definition);
    }

    /**
     * Executes a tool with the given arguments and context.
     * @description Looks up the tool in appropriate registries based on agent type,
     * validates access permissions, and executes the tool.
     * @param {string} name - Name of the tool to execute
     * @param {any} args - Arguments for the tool
     * @param {ToolContext} context - Execution context
     * @param {boolean} isSubAgent - Whether the caller is a sub-agent
     * @returns {Promise<string>} Tool execution result as string
     * @throws {Error} If tool execution fails
     * @example
     * const result = await toolManager.executeTool(
     *   'read_file', 
     *   { uri: 'file.txt' }, 
     *   context, 
     *   false
     * );
     */
    public async executeTool(
        name: string, 
        args: any, 
        context: ToolContext, 
        isSubAgent: boolean
    ): Promise<string> {
        const tool = this.getTool(name, isSubAgent);
        if (typeof tool === 'string') {
            return tool; // Error message
        }
        return await tool.execute(args, context);
    }

    /**
     * Gets the pretty print string for a tool call.
     * @description Looks up the tool and generates a human-readable description
     * of the tool call using the tool's prettyPrint method.
     * @param {string} name - Name of the tool
     * @param {any} args - Arguments for the tool
     * @param {boolean} isSubAgent - Whether the caller is a sub-agent
     * @returns {string} Human-readable description of the tool call
     * @example
     * const summary = toolManager.getPrettyPrint('read_file', { uri: 'file.txt' }, false);
     * // Returns: '📖 Mutsumi read file.txt'
     */
    public getPrettyPrint(name: string, args: any, isSubAgent: boolean): string {
        const tool = this.getTool(name, isSubAgent);
        if (typeof tool === 'string') {
            return `🔧 Tool Call: ${name}`; // Fallback for unknown tools
        }
        return tool.prettyPrint(args);
    }

    /**
     * Helper method to look up a tool by name.
     * @private
     * @param {string} name - Name of the tool
     * @param {boolean} isSubAgent - Whether the caller is a sub-agent
     * @returns {ITool | string} The tool instance, or an error message string if not found
     */
    private getTool(name: string, isSubAgent: boolean): ITool | string {
        let tool = this.commonTools.get(name);
        if (!tool) {
            if (isSubAgent) {
                tool = this.subOnlyTools.get(name);
            } else {
                tool = this.mainOnlyTools.get(name);
            }
        }

        if (!tool) {
            // Check skills
            const skillTools = SkillManager.getInstance().getTools();
            tool = skillTools.find(s => s.name === name);
        }

        if (!tool) {
            if (isSubAgent && this.mainOnlyTools.has(name)) {
                 return `Error: Tool '${name}' is not available for Sub-Agents.`;
            }
            if (!isSubAgent && this.subOnlyTools.has(name)) {
                 return `Error: Tool '${name}' is only available for Sub-Agents.`;
            }
            return `Error: Unknown tool '${name}'`;
        }
        return tool;
    }
}
