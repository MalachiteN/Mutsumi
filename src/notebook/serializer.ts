import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AgentContext, AgentMessage, AgentMetadata } from '../types';
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
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    msg.content || '',
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
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `**System**: ${msg.content}`,
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
        const raw: AgentContext = {
            metadata: {
                uuid: uuidv4(),
                name: 'New Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: allowedUris
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
                    displayText += m.content + '\n\n';
                }
                if (m.tool_calls) {
                    for (const tc of m.tool_calls) {
                        displayText += `> 🔧 **Call**: \`${tc.function.name}\`\n\n`;
                    }
                }
            } else if (m.role === 'tool') {
                const truncated = (m.content || '').length > 200 
                    ? (m.content || '').substring(0, 200) + '...' 
                    : (m.content || '');
                displayText += `<details><summary>📝 Result: ${m.name}</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>\n\n`;
            }
        }
        return displayText;
    }
}