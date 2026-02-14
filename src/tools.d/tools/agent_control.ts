import * as vscode from 'vscode';
import { ITool, ToolContext } from '../interface';
import { AgentOrchestrator } from '../../agent/agentOrchestrator';
import { resolveUri } from '../utils';

export const selfForkTool: ITool = {
    name: 'self_fork',
    definition: {
        type: 'function',
        function: {
            name: 'self_fork',
            description: 'Split into multiple parallel sub-agents. Creates new agent files immediately. The current agent will suspend until all sub-agents are finished (task_finish called) or their files are deleted.',
            parameters: {
                type: 'object',
                properties: {
                    context_summary: { 
                        type: 'string', 
                        description: 'Context summary for the sub-agents (unused in this version, pass empty string or purpose).' 
                    },
                    sub_agents: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                prompt: { type: 'string', description: 'Instruction for the sub-agent.' },
                                allowed_uris: { 
                                    type: 'array', 
                                    items: { type: 'string' },
                                    description: 'Allowed paths.'
                                },
                                model: { 
                                    type: 'string', 
                                    description: 'The model name (must in the avaliable models list) that will be used by the sub-agent' 
                                }
                            },
                            required: ['prompt', 'allowed_uris']
                        }
                    }
                },
                required: ['context_summary', 'sub_agents']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        if (!context.notebook) return 'Error: Only available in Mutsumi Notebook.';
        const parentUuid = context.notebook.metadata.uuid;
        if (!parentUuid) return 'Error: No Agent UUID found.';

        const { context_summary, sub_agents } = args;
        
        if (!sub_agents || !Array.isArray(sub_agents) || sub_agents.length === 0) {
            return 'Error: sub_agents list empty.';
        }

        try {
            // Normalize allowed_uris to standard URI strings
            const normalizedSubAgents = sub_agents.map((agent: any) => {
                if (agent.allowed_uris && Array.isArray(agent.allowed_uris)) {
                    return {
                        ...agent,
                        allowed_uris: agent.allowed_uris.map((u: string) => {
                            try {
                                return resolveUri(u).toString();
                            } catch (e) {
                                return u; // Fallback to original if resolve fails
                            }
                        })
                    };
                }
                return agent;
            });

            if (context.appendOutput) {
                await context.appendOutput(`\n\n**🔄 Created ${normalizedSubAgents.length} sub-agents...**\nPlease run them manually in the sidebar or opened windows.\nWaiting for completion...`);
            }

            // This blocks until all children are finished or deleted
            const report = await AgentOrchestrator.getInstance().requestFork(
                parentUuid, 
                context_summary, 
                normalizedSubAgents,
                context.abortSignal
            );
            
            return report;
        } catch (err: any) {
            return `Error during fork: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        const agentCount = args.sub_agents?.length || 0;
        return `🍴 Mutsumi forked into ${agentCount} sub-agent${agentCount !== 1 ? 's' : ''}`;
    },
    argsToCodeBlock: [ 'sub_agents' ],
    codeBlockFilePaths: [ undefined ]
};

export const taskFinishTool: ITool = {
    name: 'task_finish',
    definition: {
        type: 'function',
        function: {
            name: 'task_finish',
            description: 'Mark task as complete and submit report.',
            parameters: {
                type: 'object',
                properties: {
                    context_summary: { type: 'string', description: 'Final report.' }
                },
                required: ['context_summary']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        if (!context.notebook) return 'Error: Only available in Mutsumi Notebook.';
        const myUuid = context.notebook.metadata.uuid;
        const summary = args.context_summary;
        
        AgentOrchestrator.getInstance().reportTaskFinished(myUuid, summary);
        
        // Signal task completion
        if (context.signalTermination) {
            context.signalTermination(true);
        }
        
        return 'Task Finished. Report submitted.';
    },
    prettyPrint: (_args: any) => {
        return `✅ Mutsumi finished task`;
    },
    argsToCodeBlock: [ 'context_summary' ],
    codeBlockFilePaths: [ undefined ]
};

export const getAvailableModelsTool: ITool = {
    name: 'get_available_models',
    definition: {
        type: 'function',
        function: {
            name: 'get_available_models',
            description: 'Get the configured models list and their labels',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    execute: async (_args: any, _context: ToolContext) => {
        try {
            const config = vscode.workspace.getConfiguration('mutsumi');
            const models = config.get<Record<string, string>>('models', {});
            
            const modelEntries = Object.entries(models);
            if (modelEntries.length === 0) {
                return 'No models configured.';
            }
            
            const lines: string[] = [];
            for (const [modelName, label] of modelEntries) {
                const trimmedLabel = label?.trim() || '';
                if (trimmedLabel) {
                    lines.push(`${modelName}: ${trimmedLabel}`);
                } else {
                    lines.push(modelName);
                }
            }
            
            return lines.join('\n');
        } catch (err: any) {
            return `Error reading models configuration: ${err.message}`;
        }
    },
    prettyPrint: (_args: any) => {
        return `🐧 Mutsumi listed available models`;
    }
};