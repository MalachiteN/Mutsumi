import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContentPartImage, ContentPartText } from '../types';
import { getSystemPrompt } from './prompts';
import { ContextResolver } from './contextResolver';

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
    
    let systemPromptContent = await getSystemPrompt(wsUri, allowedUris, isSubAgent);

    // Resolve @[] references in the current prompt and append to system prompt
    const contextInjection = await ContextResolver.resolveReferencesInText(currentPrompt, wsUri.fsPath, allowedUris);
    if (contextInjection) {
        systemPromptContent += "\n\n" + contextInjection;
    }

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
            // 如果是 User 消息，尝试解析图片
            // 注意：只有当 metadata 中没有 mutsumi_interaction（即还没运行过）或者单纯是历史记录时
            // 对于已经运行过的 user cell，也需要重新构建 User 消息。
            
            if (role === 'user') {
                const multiModalContent = await parseUserMessageWithImages(content);
                messages.push({ role: 'user', content: multiModalContent });
            } else {
                // Assistant 消息通常是纯文本或 tool calls，暂不涉及图片输出（除非未来支持生成图片）
                messages.push({ role: role as any, content });
            }
        }

        if (prevCell.metadata?.mutsumi_interaction) {
            const interaction = prevCell.metadata.mutsumi_interaction as AgentMessage[];
            messages.push(...interaction);
        }
    }

    // 3. 添加当前用户 Prompt (解析图片)
    const currentMultiModalContent = await parseUserMessageWithImages(currentPrompt);
    messages.push({ role: 'user', content: currentMultiModalContent });

    return { messages, allowedUris, isSubAgent };
}

// 图片正则：![alt](uri)
const IMG_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

async function parseUserMessageWithImages(text: string): Promise<MessageContent> {
    const matches = [...text.matchAll(IMG_REGEX)];
    
    if (matches.length === 0) {
        return text;
    }

    const content: (ContentPartText | ContentPartImage)[] = [];
    let lastIndex = 0;

    for (const match of matches) {
        const [fullMatch, altText, uriStr] = match;
        const index = match.index!;

        // 添加图片前的文本
        if (index > lastIndex) {
            content.push({
                type: 'text',
                text: text.substring(lastIndex, index)
            });
        }

        // 处理图片
        try {
            const imageBase64 = await readImageAsBase64(uriStr);
            if (imageBase64) {
                content.push({
                    type: 'image_url',
                    image_url: {
                        url: imageBase64,
                        detail: 'auto' // 可以根据需要调整
                    }
                });
            } else {
                // 如果读取失败，保留原始 Markdown
                content.push({ type: 'text', text: fullMatch });
            }
        } catch (e) {
            console.error(`Failed to read image ${uriStr}:`, e);
            content.push({ type: 'text', text: fullMatch });
        }

        lastIndex = index + fullMatch.length;
    }

    // 添加剩余文本
    if (lastIndex < text.length) {
        content.push({
            type: 'text',
            text: text.substring(lastIndex)
        });
    }

    return content;
}

async function readImageAsBase64(uriStr: string): Promise<string | null> {
    try {
        const uri = vscode.Uri.parse(uriStr);
        // 只处理 file 协议，且位于本地的文件
        if (uri.scheme !== 'file') {
             // 暂不支持网络图片，除非 LLM 原生支持 URL。
             // OpenAI 支持 http URL，但这里我们的需求是本地临时文件。
             // 如果是 http，直接返回 null 吗？或者直接透传 url？
             // OpenAI API 接受 http URL。如果用户贴了个网络图，我们可以直接传 URL。
             if (uri.scheme === 'http' || uri.scheme === 'https') {
                 return uriStr; 
             }
             return null;
        }

        const bytes = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(bytes);
        
        // 简单的 MIME 类型推断
        const ext = uriStr.split('.').pop()?.toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === 'png') mimeType = 'image/png';
        if (ext === 'webp') mimeType = 'image/webp';
        if (ext === 'gif') mimeType = 'image/gif';

        return `data:${mimeType};base64,${buffer.toString('base64')}`;

    } catch (e) {
        console.error('Error reading image file:', e);
        return null;
    }
}
