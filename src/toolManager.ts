import { ITool, ToolContext } from './tools.d/interface';
import { readFileTool } from './tools.d/read_file';
import { lsTool } from './tools.d/ls';
import { shellExecTool } from './tools.d/shell_exec';
import { editFileSearchReplaceTool } from './tools.d/edit_file_search_replace';
import { editFileFullReplaceTool } from './tools.d/edit_file_full_replace';

import { partiallyReadByRangeTool, partiallyReadAroundKeywordTool } from './tools.d/read_partial';
import { searchFileContainsKeywordTool, searchFileNameIncludesTool } from './tools.d/search_fs';
import { getFileSizeTool, getEnvVarTool, systemInfoTool } from './tools.d/system_info';
import { mkdirTool, createNewFileTool } from './tools.d/fs_write_ops';
import { gitCmdTool } from './tools.d/git_cmd';
import { selfForkTool, taskFinishTool, getAvailableModelsTool } from './tools.d/agent_control';
import { projectOutlineTool } from './tools.d/project_outline';
import { getWarningErrorTool } from './tools.d/get_warning_error';

import OpenAI from 'openai';

export class ToolManager {
    private commonTools = new Map<string, ITool>();
    private mainOnlyTools = new Map<string, ITool>();
    private subOnlyTools = new Map<string, ITool>();

    constructor() {
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

    private registerCommon(tool: ITool) { this.commonTools.set(tool.name, tool); }
    private registerMain(tool: ITool) { this.mainOnlyTools.set(tool.name, tool); }
    private registerSub(tool: ITool) { this.subOnlyTools.set(tool.name, tool); }

    public getToolsDefinitions(isSubAgent: boolean): OpenAI.Chat.ChatCompletionTool[] {
        const tools: ITool[] = [
            ...this.commonTools.values(),
            ...(isSubAgent ? this.subOnlyTools.values() : this.mainOnlyTools.values())
        ];
        return tools.map(t => t.definition);
    }

    public async executeTool(name: string, args: any, context: ToolContext, isSubAgent: boolean): Promise<string> {
        // Check access
        let tool = this.commonTools.get(name);
        if (!tool) {
            if (isSubAgent) {
                tool = this.subOnlyTools.get(name);
            } else {
                tool = this.mainOnlyTools.get(name);
            }
        }

        if (!tool) {
            // Check if it exists in the other scope to give a better error message
            if (isSubAgent && this.mainOnlyTools.has(name)) {
                 return `Error: Tool '${name}' is not available for Sub-Agents.`;
            }
            if (!isSubAgent && this.subOnlyTools.has(name)) {
                 return `Error: Tool '${name}' is only available for Sub-Agents.`;
            }
            return `Error: Unknown tool '${name}'`;
        }
        return await tool.execute(args, context);
    }
}