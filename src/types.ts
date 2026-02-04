export interface AgentMetadata {
    uuid: string;
    name: string;
    created_at: string;
    parent_agent_id: string | null;
    allowed_uris: string[];
    is_task_finished?: boolean;
}

export interface AgentMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls?: any[]; 
    tool_call_id?: string;
    name?: string;
    reasoning_content?: string; 
}

export interface AgentContext {
    metadata: AgentMetadata;
    context: AgentMessage[];
}

export interface ToolRequest {
    name: string;
    arguments: any;
}

export interface ToolResult {
    content: string;
    isError?: boolean;
}

// 新增：Agent 运行时状态定义
export type AgentRuntimeStatus = 'standby' | 'running' | 'pending' | 'finished';

export interface AgentStateInfo {
    uuid: string;
    parentId: string | null;
    name: string;
    fileUri: string; // string format of Uri
    
    // 状态标志位
    isWindowOpen: boolean;
    isRunning: boolean;
    isTaskFinished: boolean;
    
    // 缓存一些元数据
    prompt?: string;
}