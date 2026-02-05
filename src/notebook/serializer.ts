import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AgentContext, AgentMessage, AgentMetadata, MessageContent } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class MutsumiSerializer implements vscode.NotebookSerializer {
    async deserializeNotebook(
        content: Uint8Array,
        _token: vscode.CancellationToken
    ): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(content);
        
        let raw: AgentContext;
        try {
            raw = JSON.parse(contents);
        } catch {
            raw = {
                metadata: {
                    uuid: uuidv4(),
                    name: 'New Agent',
                    created_at: new Date().toISOString(),
                    parent_agent_id: null,
                    allowed_uris: ['/']
                },
                context: []
            };
        }

        const cells: vscode.NotebookCellData[] = [];
        const messages = raw.context;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            if (msg.role === 'user') {
                // User messages are Code cells (executable)
                // Convert multimodal content back to Markdown string for the editor
                const cellValue = this.serializeContentToString(msg.content);
                
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    cellValue,
                    'markdown'
                );
                cell.metadata = { role: 'user' };

                // Look ahead for assistant/tool messages to attach as output
                const group: AgentMessage[] = [];
                let j = i + 1;
                while (j < messages.length) {
                    const next = messages[j];
                    if (next.role === 'user' || next.role === 'system') {
                        break;
                    }
                    group.push(next);
                    j++;
                }

                if (group.length > 0) {
                    // Consume the grouped messages
                    i = j - 1;

                    // Store interaction in metadata for serialization
                    cell.metadata.mutsumi_interaction = group;

                    // Render group to Markdown for display as Cell Output
                    const displayText = this.renderInteractionToMarkdown(group);
                    const item = vscode.NotebookCellOutputItem.text(displayText, 'text/markdown');
                    cell.outputs = [new vscode.NotebookCellOutput([item])];
                }

                cells.push(cell);
            } else if (msg.role === 'system') {
                // System messages rendered as Markup for visibility
                const cellValue = this.serializeContentToString(msg.content);
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `**System**: ${cellValue}`,
                    'markdown'
                );
                cell.metadata = { role: 'system' };
                cells.push(cell);
            } else {
                // Assistant / Tool messages: group consecutive non-user/non-system messages
                const group: AgentMessage[] = [msg];
                
                while (i + 1 < messages.length) {
                    const next = messages[i + 1];
                    if (next.role === 'user' || next.role === 'system') {
                        break;
                    }
                    group.push(next);
                    i++;
                }

                // Render group to Markdown for display
                const displayText = this.renderInteractionToMarkdown(group);

                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    displayText,
                    'markdown'
                );
                cell.metadata = { 
                    role: 'assistant', 
                    mutsumi_interaction: group 
                };
                cells.push(cell);
            }
        }

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata;
        
        return notebookData;
    }

    static createDefaultContent(allowedUris: string[]): Uint8Array {
        // 读取 VS Code 配置获取默认模型
        const config = vscode.workspace.getConfiguration('mutsumi');
        const defaultModel = config.get<string>('defaultModel');

        const raw: AgentContext = {
            metadata: {
                uuid: uuidv4(),
                name: 'New Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: allowedUris,
                model: defaultModel || undefined
            },
            context: []
        };
        return new TextEncoder().encode(JSON.stringify(raw, null, 2));
    }

    async serializeNotebook(
        data: vscode.NotebookData,
        _token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        const context: AgentMessage[] = [];
        const cells = data.cells;
        
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const role = cell.metadata?.role || 'user';
            
            if (role === 'system') {
                context.push({ role: 'system', content: cell.value.replace('**System**: ', '') });
            }
            else if (role === 'user') {
                // For user cell, we store the raw string content (Markdown).
                // During execution, this Markdown is parsed into Multimodal structure if needed.
                // But in 'context' (serialization), we can store the string as is, 
                // OR we can parse it to store structured data. 
                // Currently Mutsumi stores the raw user input as string content in the JSON file.
                // The history builder parses it at runtime. This is consistent.
                context.push({ role: 'user', content: cell.value });
                
                // Check if this user cell has interaction metadata (from execution or deserialization)
                if (cell.metadata?.mutsumi_interaction) {
                    context.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                }
            }
            else {
                // Markup cell (assistant response from file load)
                if (cell.metadata?.mutsumi_interaction) {
                    context.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                } else {
                    // Legacy or manually edited markdown
                    context.push({ role: 'assistant', content: cell.value });
                }
            }
        }

        const output: AgentContext = {
            metadata: data.metadata as AgentMetadata,
            context: context
        };

        return new TextEncoder().encode(JSON.stringify(output, null, 2));
    }

    private renderInteractionToMarkdown(group: AgentMessage[]): string {
        let displayText = '';
        for (const m of group) {
            if (m.role === 'assistant') {
                if (m.reasoning_content) {
                    displayText += `<details><summary>💭 Thinking Process</summary>\n\n${m.reasoning_content}\n\n</details>\n\n`;
                }
                if (m.content) {
                    displayText += this.serializeContentToString(m.content) + '\n\n';
                }
                if (m.tool_calls) {
                    for (const tc of m.tool_calls) {
                        displayText += `> 🔧 **Call**: \`${tc.function.name}\`\n\n`;
                    }
                }
            } else if (m.role === 'tool') {
                const contentStr = this.serializeContentToString(m.content);
                const truncated = contentStr.length > 200 
                    ? contentStr.substring(0, 200) + '...' 
                    : contentStr;
                displayText += `<details><summary>📝 Result: ${m.name}</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>\n\n`;
            }
        }
        return displayText;
    }

    private serializeContentToString(content: MessageContent | null | undefined): string {
        if (!content) return '';
        if (typeof content === 'string') return content;
        
        return content.map(part => {
            if (part.type === 'text') {
                return part.text;
            } else if (part.type === 'image_url') {
                // Try to reconstruct markdown image if possible, or just a placeholder
                // If it was base64, we probably don't want to dump it all here, but for now let's be safe.
                // Actually, if we are deserializing from a file where we saved base64, 
                // displaying it back in the editor as markdown might be heavy if we include the base64 string.
                // However, usually we don't save the base64 in the serialized file if the user didn't write base64.
                // Wait, if we use parseUserMessageWithImages at runtime, the serialized JSON contains what?
                // The serialized JSON (AgentContext) contains the history. 
                // If we ran the agent, the history messages (especially User ones) might be transformed?
                // Actually, in `serializeNotebook` (line 143), we push `cell.value` (string) for User role.
                // We DO NOT push the transformed multimodal array for the User message into the JSON file.
                // We only perform the transformation at runtime in `history.ts`.
                // So the User message in the JSON file remains a string.
                // 
                // BUT, Assistant messages *could* be multimodal (if GPT-4V generates images in future).
                // For now, Assistant is text. 
                // So this function handles the case where we might have multimodal data in `mutsumi_interaction`.
                
                // If it is a base64 data url, we can try to show it as an image tag.
                return `![image](${part.image_url.url})`; 
            }
            return '';
        }).join('');
    }
}
