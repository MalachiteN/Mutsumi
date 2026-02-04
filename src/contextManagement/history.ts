import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata } from '../types';
import { getSystemPrompt } from './prompts';
import { ContextResolver } from '../notebook/contextResolver';

/**
 * 构建 Agent 的对话历史上下文 (Async now)
 */
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }> {
    const messages: AgentMessage[] = [];
    
    // 1. 获取 System Prompt (Dynamic)
    const metadata = notebook.metadata as AgentMetadata;
    const allowedUris = metadata.allowed_uris || ['/'];
    const isSubAgent = !!metadata.parent_agent_id;

    // 假设 workspaceFolder 获取逻辑 (简化版，取第一个)
    const wsUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : notebook.uri;
    
    const systemPromptContent = await getSystemPrompt(wsUri, allowedUris, isSubAgent);

    messages.push({
        role: 'system',
        content: systemPromptContent
    });

    // 2. 从之前的 Cell 中加载历史
    for (let i = 0; i < currentCellIndex; i++) {
        const prevCell = notebook.cellAt(i);
        const role = prevCell.metadata?.role || 'user';
        
        const content = prevCell.document.getText();
        if (content.trim()) {
            messages.push({ role: role as any, content });
        }

        if (prevCell.metadata?.mutsumi_interaction) {
            const interaction = prevCell.metadata.mutsumi_interaction as AgentMessage[];
            messages.push(...interaction);
        }
    }

    // 3. 处理当前 Prompt 中的 @ 引用
    // 解析 @[path:...] 并读取内容
    const contextInjection = await ContextResolver.resolveReferencesInText(currentPrompt, wsUri.fsPath);
    
    // 如果有引用内容，作为一个 User 消息先注入，明确告知 LLM 这是附加上下文
    if (contextInjection) {
        messages.push({
            role: 'user',
            content: contextInjection
        });
    }

    // 4. 添加当前用户 Prompt (保留原始的 @ 标记，方便 LLM 知道用户指代的是什么)
    messages.push({ role: 'user', content: currentPrompt });

    return { messages, allowedUris, isSubAgent };
}