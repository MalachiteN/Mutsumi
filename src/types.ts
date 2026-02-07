/**
 * @fileoverview Core type definitions for the Mutsumi VSCode extension.
 * @module types
 */

/**
 * Metadata for an agent session stored in notebook metadata.
 * @interface AgentMetadata
 */
export interface AgentMetadata {
    /** Unique identifier for the agent */
    uuid: string;
    /** Display name of the agent */
    name: string;
    /** ISO timestamp when the agent was created */
    created_at: string;
    /** Parent agent ID if this is a sub-agent, null otherwise */
    parent_agent_id: string | null;
    /** List of URIs the agent is allowed to access */
    allowed_uris: string[];
    /** Whether the agent task has been completed */
    is_task_finished?: boolean;
    /** Model identifier used for this agent */
    model?: string;
}

/**
 * Text content part for multimodal messages.
 * @interface ContentPartText
 */
export type ContentPartText = { type: 'text'; text: string };

/**
 * Image content part for multimodal messages.
 * @interface ContentPartImage
 */
export type ContentPartImage = { 
    type: 'image_url'; 
    image_url: { 
        url: string; 
        detail?: 'auto' | 'low' | 'high' 
    } 
};

/**
 * Message content can be plain text or multimodal parts.
 */
export type MessageContent = string | (ContentPartText | ContentPartImage)[];

/**
 * Message in an agent conversation.
 * @interface AgentMessage
 */
export interface AgentMessage {
    /** Role of the message sender */
    role: 'user' | 'assistant' | 'system' | 'tool';
    /** Message content, null if only tool calls */
    content: MessageContent | null;
    /** Tool calls requested by assistant */
    tool_calls?: any[];
    /** ID of the tool call this message responds to */
    tool_call_id?: string;
    /** Name of the tool being called */
    name?: string;
    /** Reasoning/thinking content from the model */
    reasoning_content?: string;
}

/**
 * Complete agent context including metadata and conversation history.
 * @interface AgentContext
 */
export interface AgentContext {
    /** Agent metadata */
    metadata: AgentMetadata;
    /** Conversation message history */
    context: AgentMessage[];
}

/**
 * Tool request from the agent.
 * @interface ToolRequest
 */
export interface ToolRequest {
    /** Name of the tool to execute */
    name: string;
    /** Arguments for the tool */
    arguments: any;
}

/**
 * Result of a tool execution.
 * @interface ToolResult
 */
export interface ToolResult {
    /** Result content as string */
    content: string;
    /** Whether the tool execution resulted in an error */
    isError?: boolean;
}

/**
 * Runtime status of an agent.
 * - 'standby': Main agent, not running
 * - 'running': Currently executing
 * - 'pending': Sub-agent, waiting to run
 * - 'finished': Task completed
 */
export type AgentRuntimeStatus = 'standby' | 'running' | 'pending' | 'finished';

/**
 * Runtime state information for an agent.
 * @interface AgentStateInfo
 */
export interface AgentStateInfo {
    /** Unique identifier for the agent */
    uuid: string;
    /** Parent agent ID if this is a sub-agent */
    parentId: string | null;
    /** Display name of the agent */
    name: string;
    /** File URI string where the agent is stored */
    fileUri: string;
    
    /** Whether the notebook window is currently open */
    isWindowOpen: boolean;
    /** Whether the agent is currently running */
    isRunning: boolean;
    /** Whether the agent task has finished */
    isTaskFinished: boolean;
    
    /** Cached prompt text for the agent */
    prompt?: string;
}
