import { ITool, ToolContext } from './interface';
import { AgentOrchestrator } from '../agentOrchestrator';

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
            if (context.appendOutput) {
                await context.appendOutput(`\n\n**🔄 Creating ${sub_agents.length} sub-agents...**\nPlease run them manually in the sidebar or opened windows.\nWaiting for completion...`);
            }

            // This blocks until all children are finished or deleted
            const report = await AgentOrchestrator.getInstance().requestFork(
                parentUuid, 
                context_summary, 
                sub_agents,
                context.abortSignal
            );
            
            return report;
        } catch (err: any) {
            return `Error during fork: ${err.message}`;
        }
    }
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
        return 'Task Finished. Report submitted.';
    }
};