import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AgentContext, AgentMessage, AgentMetadata, MessageContent } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * @description Mutsumi Notebook serializer class
 * @class MutsumiSerializer
 * @implements {vscode.NotebookSerializer}
 * 
 * Responsible for serializing and deserializing Agent conversation notebooks, 
 * converting notebook data to JSON format for storage, 
 * and restoring to VS Code Notebook cell structure when loading.
 */
export class MutsumiSerializer implements vscode.NotebookSerializer {

    /**
     * @description Deserialize notebook data
     * @param {Uint8Array} content - Byte array of file content
     * @param {vscode.CancellationToken} _token - Cancellation token
     * @returns {Promise<vscode.NotebookData>} Parsed notebook data
     * 
     * @example
     * const serializer = new MutsumiSerializer();
     * const notebookData = await serializer.deserializeNotebook(fileContent, token);
     */
    async deserializeNotebook(
        content: Uint8Array,
        _token: vscode.CancellationToken
    ): Promise<vscode.NotebookData> {
        const contents = new TextDecoder().decode(content);

        let raw: AgentContext;
        try {
            raw = JSON.parse(contents);
        } catch {
            // Create default Agent context when parsing fails
            raw = {
                metadata: {
                    uuid: uuidv4(),
                    name: 'New Agent',
                    created_at: new Date().toISOString(),
                    parent_agent_id: null,
                    allowed_uris: ['/'],
                    contextItems: []
                },
                context: []
            };
        }

        const cells: vscode.NotebookCellData[] = [];
        const messages = raw.context;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            if (msg.role === 'user') {
                // User messages as code cells (executable)
                const cellValue = this.serializeContentToString(msg.content);

                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    cellValue,
                    'markdown'
                );
                cell.metadata = { role: 'user' };

                // Look ahead for associated assistant/tool messages
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
                    i = j - 1;

                    // Store interaction info in metadata for serialization
                    cell.metadata.mutsumi_interaction = group;

                    // Render interaction group as Markdown for cell output
                    const displayText = this.renderInteractionToMarkdown(group);
                    const item = vscode.NotebookCellOutputItem.text(displayText, 'text/markdown');
                    cell.outputs = [new vscode.NotebookCellOutput([item])];
                }

                cells.push(cell);
            } else if (msg.role === 'system') {
                // System messages displayed as markup cells
                const cellValue = this.serializeContentToString(msg.content);
                const cell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `**System**: ${cellValue}`,
                    'markdown'
                );
                cell.metadata = { role: 'system' };
                cells.push(cell);
            } else {
                // Assistant/tool messages: group consecutive non-user/non-system messages
                const group: AgentMessage[] = [msg];

                while (i + 1 < messages.length) {
                    const next = messages[i + 1];
                    if (next.role === 'user' || next.role === 'system') {
                        break;
                    }
                    group.push(next);
                    i++;
                }

                // Render group as Markdown display
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

    /**
     * @description Create default notebook content
     * @param {string[]} allowedUris - List of allowed URIs
     * @returns {Uint8Array} Encoded default content
     * @static
     * 
     * @example
     * const content = MutsumiSerializer.createDefaultContent(['/workspace/project']);
     * await vscode.workspace.fs.writeFile(uri, content);
     */
    static createDefaultContent(allowedUris: string[]): Uint8Array {
        // Read VS Code configuration to get default model
        const config = vscode.workspace.getConfiguration('mutsumi');
        const defaultModel = config.get<string>('defaultModel');

        const raw: AgentContext = {
            metadata: {
                uuid: uuidv4(),
                name: 'New Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: allowedUris,
                model: defaultModel || undefined,
                contextItems: []
            },
            context: []
        };
        return new TextEncoder().encode(JSON.stringify(raw, null, 2));
    }

    /**
     * @description Serialize notebook data
     * @param {vscode.NotebookData} data - Notebook data
     * @param {vscode.CancellationToken} _token - Cancellation token
     * @returns {Promise<Uint8Array>} Serialized byte array
     * 
     * @example
     * const serializer = new MutsumiSerializer();
     * const bytes = await serializer.serializeNotebook(notebookData, token);
     * await vscode.workspace.fs.writeFile(uri, bytes);
     */
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
                // User cells store raw string content
                // Strip ghost block if present (it should only exist in metadata, not in persisted content)
                const cleanContent = this.stripGhostBlockFromCell(cell.value);
                context.push({ role: 'user', content: cleanContent });

                // Check if interaction metadata exists
                if (cell.metadata?.mutsumi_interaction) {
                    context.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                }
            }
            else {
                // Markup cells (assistant responses loaded from file)
                if (cell.metadata?.mutsumi_interaction) {
                    context.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                } else {
                    // Legacy format or manually edited Markdown
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

    /**
     * @description Render interaction message group to Markdown format
     * @private
     * @param {AgentMessage[]} group - Message group
     * @returns {string} String in Markdown format
     */
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

    /**
     * @description Strip ghost block from cell content during serialization
     * Ghost block should only exist in metadata, not in persisted message content
     */
    private stripGhostBlockFromCell(value: string): string {
        const GHOST_BLOCK_MARKER = '<content_reference>';
        const index = value.indexOf(GHOST_BLOCK_MARKER);
        if (index !== -1) {
            return value.substring(0, index).trimEnd();
        }
        return value;
    }

    /**
     * @description Serialize message content to string
     * @private
     * @param {MessageContent | null | undefined} content - Message content
     * @returns {string} Serialized string
     * 
     * @description Handle multiple content formats:
     * - String: return directly
     * - Multimodal array: convert each part to appropriate format
     * - null/undefined: return empty string
     */
    private serializeContentToString(content: MessageContent | null | undefined): string {
        if (!content) return '';
        if (typeof content === 'string') return content;

        return content.map(part => {
            if (part.type === 'text') {
                return part.text;
            } else if (part.type === 'image_url') {
                // Convert image URL to Markdown image tag
                return `![image](${part.image_url.url})`;
            }
            return '';
        }).join('');
    }
}
