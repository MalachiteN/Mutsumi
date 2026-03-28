import * as vscode from 'vscode';
import { ITool, ToolContext } from '../interface';
import { AgentOrchestrator } from '../../agent/agentOrchestrator';
import { AgentTypeRegistry } from '../../registry/agentTypeRegistry';
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
                        description: 'Detailed context summary injected into each sub-agent\'s prompt. Include: overall goal, current progress, key decisions, constraints, and relevant background. Be specific enough for sub-agents to work independently.' 
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
                                agent_type: {
                                    type: 'string',
                                    description: 'The agent type for this sub-agent (e.g., "sub", "readonly-expert", "planner", "summarizer"). The model and capabilities are determined by the agent type configuration. Defaults to "sub" if not specified.'
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
        const config = await context.session.getConfig();
        const parentUuid = config.metadata?.uuid;
        const parentAgentType = config.metadata?.agentType;
        if (!parentUuid) return 'Error: No Agent UUID found.';

        const { context_summary, sub_agents } = args;
        
        if (!sub_agents || !Array.isArray(sub_agents) || sub_agents.length === 0) {
            return 'Error: sub_agents list empty.';
        }

        // Validate agent types if parent has a defined type
        const registry = AgentTypeRegistry.getInstance();
        for (const subAgent of sub_agents) {
            const agentType = subAgent.agent_type || 'sub';
            
            if (parentAgentType) {
                // Check if the requested child type is allowed for the parent
                if (!registry.isValidChildType(parentAgentType, agentType)) {
                    return `Error: Agent type '${parentAgentType}' cannot fork child of type '${agentType}'. Allowed child types: ${registry.getAgentType(parentAgentType)?.allowedChildTypes.join(', ') || 'none'}`;
                }
            }
            
            // Validate that the agent type exists
            if (!registry.hasAgentType(agentType)) {
                return `Error: Unknown agent type '${agentType}'. Available types: ${registry.getAllTypes().join(', ')}`;
            }
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
        const config = await context.session.getConfig();
        const myUuid = config.metadata?.uuid;
        if (!myUuid) return 'Error: No Agent UUID found.';
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

export const getAgentTypesTool: ITool = {
    name: 'get_agent_types',
    definition: {
        type: 'function',
        function: {
            name: 'get_agent_types',
            description: 'Get agent types that the current agent is allowed to fork. Returns a filtered list of agent types with their capabilities, default models, and tool sets. Only returns types that can be created as children of the current agent.',
            parameters: {
                type: 'object',
                properties: {
                    current_agent_type: {
                        type: 'string',
                        description: 'The current agent type (e.g., "implementer", "orchestrator"). If not provided, will be read from session metadata.'
                    }
                }
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const registry = AgentTypeRegistry.getInstance();
            
            // Get current agent type from args or session metadata
            let currentAgentType: string | undefined = args.current_agent_type;
            if (!currentAgentType) {
                const config = await context.session.getConfig();
                currentAgentType = config.metadata?.agentType;
            }
            
            if (!currentAgentType) {
                return 'Error: Unable to determine current agent type. Please provide current_agent_type parameter or ensure agent has a type configured.';
            }
            
            // Get allowed child types for current agent
            const currentConfig = registry.getAgentType(currentAgentType);
            if (!currentConfig) {
                return `Error: Unknown agent type '${currentAgentType}'.`;
            }
            
            const allowedChildTypes = currentConfig.allowedChildTypes || [];
            
            if (allowedChildTypes.length === 0) {
                return `Agent type '${currentAgentType}' cannot fork any child agents.`;
            }
            
            const lines: string[] = [];
            lines.push(`Agent type '${currentAgentType}' can fork the following types:\n`);
            
            for (const typeName of allowedChildTypes) {
                const config = registry.getAgentType(typeName);
                if (!config) continue;
                
                lines.push(`${typeName}:`);
                lines.push(`  Tool Sets: ${config.toolSets.join(', ')}`);
                lines.push(`  Default Model: ${config.defaultModel}`);
                
                // Show what this child type can further fork
                if (config.allowedChildTypes && config.allowedChildTypes.length > 0) {
                    lines.push(`  Can Further Fork: ${config.allowedChildTypes.join(', ')}`);
                } else {
                    lines.push(`  Can Further Fork: (none)`);
                }
                
                if (config.defaultRules && config.defaultRules.length > 0) {
                    lines.push(`  Default Rules: ${config.defaultRules.join(', ')}`);
                }
                
                if (config.defaultSkills && config.defaultSkills.length > 0) {
                    lines.push(`  Default Skills: ${config.defaultSkills.join(', ')}`);
                }
                
                lines.push('');
            }
            
            return lines.join('\n');
        } catch (err: any) {
            return `Error reading agent types: ${err.message}`;
        }
    },
    prettyPrint: (_args: any) => {
        return `🐧 Mutsumi listed forkable agent types`;
    }
};
