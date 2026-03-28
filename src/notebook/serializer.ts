import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AgentContext, AgentMessage, AgentMetadata, MessageContent } from '../types';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import { ToolManager } from '../tools.d/toolManager';
import { v4 as uuidv4 } from 'uuid';
import { UIRenderer } from '../agent/uiRenderer';
import { debugLogger } from '../debugLogger';
import { resolveAgentDefaults } from '../config/resolver';

// ============================================================================
// Core Data Structures (VSCode-agnostic)
// ============================================================================

/**
 * Generic cell data structure, independent of VSCode API.
 * Used by both NotebookSerializer and HeadlessAdapter.
 */
export interface GenericCellData {
    /** Cell kind: 1 = Markup (assistant), 2 = Code (user) */
    kind: 1 | 2;
    /** Cell content value */
    value: string;
    /** Cell metadata including role, ghost blocks, interaction */
    metadata?: {
        role?: 'user' | 'assistant' | 'system';
        last_ghost_block?: string;
        mutsumi_interaction?: AgentMessage[];
        [key: string]: any;
    };
}

/**
 * Result of converting AgentMessage array to cells.
 */
export interface MessageToCellsResult {
    cells: GenericCellData[];
}

/**
 * Convert AgentMessage array to generic cells (message grouping logic).
 * This is the core algorithm shared between Notebook and Headless adapters.
 * 
 * Rules:
 * - User messages become Code cells (kind: 2)
 * - Assistant messages become Markup cells (kind: 1)
 * - Consecutive assistant + tool messages are grouped into one cell's mutsumi_interaction
 * - System messages become Markup cells with special formatting
 * 
 * IMPORTANT: mutsumi_interaction ONLY exists on user cells, never on assistant cells.
 * Assistant/tool messages following a user message are stored in that user cell's
 * mutsumi_interaction array for rendering as output.
 */
export function messagesToGenericCells(messages: AgentMessage[]): GenericCellData[] {
    debugLogger.log(`[messagesToGenericCells] ==== START, input message count: ${messages?.length ?? 0} ====`);
    const cells: GenericCellData[] = [];

    if (!messages || messages.length === 0) {
        debugLogger.log('[messagesToGenericCells] Empty messages array, returning empty cells');
        return cells;
    }

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        debugLogger.log(`[messagesToGenericCells] Processing message ${i}: role=${msg.role}`);

        if (msg.role === 'user') {
            // User message as Code cell
            const cellValue = serializeContentToString(msg.content);
            debugLogger.log(`[messagesToGenericCells]   - User cell, content length: ${cellValue.length}`);
            const cell: GenericCellData = {
                kind: 2,
                value: cellValue,
                metadata: { role: 'user' }
            };

            // Preserve metadata (especially ghost block state)
            if (msg.metadata) {
                const { mutsumi_interaction, role, ...rest } = msg.metadata;
                cell.metadata = { ...cell.metadata, ...rest };
                debugLogger.log(`[messagesToGenericCells]   - Preserved metadata keys: ${Object.keys(rest).join(',')}`);
            }

            // Look ahead for associated assistant/tool messages
            // These will be stored in mutsumi_interaction and rendered as this cell's output
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
                cell.metadata = cell.metadata || {};
                cell.metadata.mutsumi_interaction = group;
                debugLogger.log(`[messagesToGenericCells]   - Attached interaction group with ${group.length} messages, advanced i to ${i}`);
            }

            cells.push(cell);
            debugLogger.log(`[messagesToGenericCells]   - Added user cell #${cells.length}`);
        } else if (msg.role === 'system') {
            // System message as Markup cell
            const cellValue = serializeContentToString(msg.content);
            debugLogger.log(`[messagesToGenericCells]   - System cell, content length: ${cellValue.length}`);
            cells.push({
                kind: 1,
                value: `**System**: ${cellValue}`,
                metadata: { role: 'system' }
            });
            debugLogger.log(`[messagesToGenericCells]   - Added system cell #${cells.length}`);
        } else {
            // Assistant/tool message WITHOUT a preceding user message
            // This is an orphan message (e.g., file starts with assistant message)
            // Create a standalone assistant cell with NO mutsumi_interaction
            debugLogger.log(`[messagesToGenericCells]   - Orphan assistant/tool message (no preceding user), starting group...`);
            const group: AgentMessage[] = [msg];

            while (i + 1 < messages.length) {
                const next = messages[i + 1];
                if (next.role === 'user' || next.role === 'system') {
                    break;
                }
                group.push(next);
                i++;
            }

            debugLogger.log(`[messagesToGenericCells]   - Orphan group formed with ${group.length} messages`);
            const displayText = renderInteractionToMarkdown(group, false);

            cells.push({
                kind: 1,
                value: displayText,
                metadata: {
                    role: 'assistant'
                    // NOTE: No mutsumi_interaction here! Orphan assistant messages
                    // are rendered directly to cell value, not stored in metadata.
                }
            });
            debugLogger.log(`[messagesToGenericCells]   - Added orphan assistant cell #${cells.length}, displayText length: ${displayText.length}`);
        }
    }

    debugLogger.log(`[messagesToGenericCells] ==== END, generated ${cells.length} cells ====`);
    return cells;
}

/**
 * Convert generic cells back to AgentMessage array.
 * Used for serialization to file.
 * 
 * NOTE: mutsumi_interaction is ONLY expanded from user cells, never from assistant cells.
 */
export function genericCellsToMessages(cells: GenericCellData[]): AgentMessage[] {
    debugLogger.log(`[genericCellsToMessages] ==== START, input ${cells?.length ?? 0} cells ====`);
    const messages: AgentMessage[] = [];

    if (!cells || cells.length === 0) {
        debugLogger.log('[genericCellsToMessages] Empty cells array, returning empty messages');
        return messages;
    }

    for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];
        const role = cell.metadata?.role || 'user';
        debugLogger.log(`[genericCellsToMessages] Cell ${idx}: kind=${cell.kind}, role=${role}, value length=${cell.value?.length ?? 0}`);

        if (role === 'system') {
            messages.push({
                role: 'system',
                content: cell.value.replace('**System**: ', '')
            });
            debugLogger.log(`[genericCellsToMessages]   - Added system message`);
        } else if (role === 'user') {
            // Strip ghost block from persisted content
            const cleanContent = stripGhostBlockFromCell(cell.value);

            const userMsg: AgentMessage = {
                role: 'user',
                content: cleanContent
            };

            // Preserve metadata (especially ghost block state)
            if (cell.metadata) {
                const { mutsumi_interaction, role, ...rest } = cell.metadata;
                if (Object.keys(rest).length > 0) {
                    userMsg.metadata = rest;
                    debugLogger.log(`[genericCellsToMessages]   - Preserved metadata keys: ${Object.keys(rest).join(',')}`);
                }
            }

            messages.push(userMsg);
            debugLogger.log(`[genericCellsToMessages]   - Added user message, content length: ${cleanContent.length}`);

            // Expand interaction if exists (ONLY for user cells)
            if (cell.metadata?.mutsumi_interaction) {
                messages.push(...cell.metadata.mutsumi_interaction);
                debugLogger.log(`[genericCellsToMessages]   - Expanded interaction: ${cell.metadata.mutsumi_interaction.length} messages`);
            }
        } else {
            // Assistant cell: use cell value directly, ignore any mutsumi_interaction
            // (mutsumi_interaction should never exist on assistant cells, but handle gracefully)
            messages.push({ role: 'assistant', content: cell.value });
            debugLogger.log(`[genericCellsToMessages]   - Added assistant message from cell value, content length: ${cell.value.length}`);
        }
    }

    debugLogger.log(`[genericCellsToMessages] ==== END, generated ${messages.length} messages ====`);
    return messages;
}

/**
 * Extract ghost blocks from generic cells.
 * Returns array of ghost blocks in order of user cells.
 */
export function extractGhostBlocksFromCells(cells: GenericCellData[]): string[] {
    const ghostBlocks: string[] = [];

    for (const cell of cells) {
        if (cell.metadata?.role === 'user' || (!cell.metadata?.role && cell.kind === 2)) {
            const ghostBlock = cell.metadata?.last_ghost_block;
            ghostBlocks.push(typeof ghostBlock === 'string' ? ghostBlock : '');
        }
    }

    return ghostBlocks;
}

/**
 * Render interaction message group to Markdown format.
 * Extracted as pure function for reuse.
 */
function renderInteractionToMarkdown(group: AgentMessage[], isSubAgent: boolean): string {
    const renderer = new UIRenderer();
    const toolCallMap = new Map<string, { name: string; args: any }>();

    for (const m of group) {
        if (m.role === 'assistant') {
            if (m.tool_calls) {
                for (const tc of m.tool_calls) {
                    let parsedArgs: any = {};
                    if (tc.function?.arguments) {
                        try {
                            parsedArgs = JSON.parse(tc.function.arguments);
                        } catch {
                            parsedArgs = {};
                        }
                    }
                    if (tc.id) {
                        toolCallMap.set(tc.id, { name: tc.function.name, args: parsedArgs });
                    }
                }
            }

            const contentStr = serializeContentToString(m.content);
            const reasoningStr = m.reasoning_content || '';

            if (contentStr || reasoningStr) {
                renderer.commitRoundUI(contentStr ? contentStr + '\n\n' : '', reasoningStr);
            }
        } else if (m.role === 'tool') {
            const contentStr = serializeContentToString(m.content);
            const mapped = m.tool_call_id ? toolCallMap.get(m.tool_call_id) : undefined;
            const toolName = mapped?.name ?? m.name ?? 'unknown';
            const args = mapped?.args ?? {};
            const prettyPrintSummary = mapped
                ? ToolManager.getInstance().getPrettyPrint(toolName, args, isSubAgent)
                : `🔧 Tool Call: ${toolName}`;

            const toolHtml = renderer.formatToolCall(
                args,
                prettyPrintSummary,
                false,
                contentStr
            );
            renderer.appendHtml(toolHtml);
        }
    }
    return renderer.getCommittedHtml();
}

/**
 * Strip ghost block from cell content.
 */
function stripGhostBlockFromCell(value: string): string {
    const GHOST_BLOCK_MARKER = '<content_reference>';
    const index = value.indexOf(GHOST_BLOCK_MARKER);
    if (index !== -1) {
        return value.substring(0, index).trimEnd();
    }
    return value;
}

/**
 * Serialize message content to string.
 */
function serializeContentToString(content: MessageContent | null | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;

    return content.map(part => {
        if (part.type === 'text') {
            return part.text;
        } else if (part.type === 'image_url') {
            return `![image](${part.image_url.url})`;
        }
        return '';
    }).join('');
}

// ============================================================================
// VSCode-specific Serialization
// ============================================================================

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
        debugLogger.log('[deserializeNotebook] ==== START ====');
        const contents = new TextDecoder().decode(content);
        debugLogger.log(`[deserializeNotebook] Decoded content length: ${contents.length} chars`);

        let raw: AgentContext;
        try {
            raw = JSON.parse(contents);
            debugLogger.log(`[deserializeNotebook] JSON parsed successfully`);
            debugLogger.log(`[deserializeNotebook] Metadata uuid: ${raw.metadata?.uuid}`);
            debugLogger.log(`[deserializeNotebook] Context message count: ${raw.context?.length ?? 0}`);
            if (raw.context && raw.context.length > 0) {
                raw.context.forEach((msg, idx) => {
                    debugLogger.log(`[deserializeNotebook] Message ${idx}: role=${msg.role}, content length=${typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length}`);
                });
            }
        } catch (err) {
            debugLogger.log(`[deserializeNotebook] JSON parse FAILED: ${err}`);
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

        // Use generic cell conversion
        debugLogger.log(`[deserializeNotebook] Converting ${raw.context?.length ?? 0} messages to generic cells...`);
        const genericCells = messagesToGenericCells(raw.context);
        debugLogger.log(`[deserializeNotebook] Generated ${genericCells.length} generic cells`);
        genericCells.forEach((cell, idx) => {
            debugLogger.log(`[deserializeNotebook] GenericCell ${idx}: kind=${cell.kind}, role=${cell.metadata?.role}, value length=${cell.value?.length ?? 0}, has interaction=${!!cell.metadata?.mutsumi_interaction}`);
            if (cell.metadata?.mutsumi_interaction) {
                debugLogger.log(`[deserializeNotebook]   - interaction count: ${cell.metadata.mutsumi_interaction.length}`);
            }
        });
        
        // Convert to VSCode cells
        debugLogger.log(`[deserializeNotebook] Converting generic cells to VSCode NotebookCellData...`);
        const cells: vscode.NotebookCellData[] = genericCells.map((genCell, idx) => {
            const cell = new vscode.NotebookCellData(
                genCell.kind === 2 ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
                genCell.value,
                'markdown'
            );
            cell.metadata = genCell.metadata;
            debugLogger.log(`[deserializeNotebook] VSCode Cell ${idx}: kind=${cell.kind}, metadata role=${cell.metadata?.role}, metadata keys=${Object.keys(cell.metadata ?? {}).join(',')}`);

            // Add outputs for user cells with mutsumi_interaction
            // mutsumi_interaction contains assistant/tool messages that should be rendered as output
            if (genCell.metadata?.role === 'user' && genCell.metadata?.mutsumi_interaction) {
                const displayText = renderInteractionToMarkdown(genCell.metadata.mutsumi_interaction, !!raw.metadata.parent_agent_id);
                const item = vscode.NotebookCellOutputItem.text(displayText, 'text/markdown');
                cell.outputs = [new vscode.NotebookCellOutput([item])];
                debugLogger.log(`[deserializeNotebook]   - added output for user cell with displayText length: ${displayText.length}`);
            }

            return cell;
        });

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata;
        debugLogger.log(`[deserializeNotebook] NotebookData created with ${cells.length} cells`);

        // Sync sub_agents_list to agentRegistry childIds on load
        if (raw.metadata.uuid) {
            const agent = AgentOrchestrator.getInstance().getAgentById(raw.metadata.uuid);
            if (agent && raw.metadata.sub_agents_list) {
                agent.childIds = new Set(raw.metadata.sub_agents_list);
                debugLogger.log(`[deserializeNotebook] Synced sub_agents_list: ${raw.metadata.sub_agents_list.length} items`);
            }
        }

        debugLogger.log('[deserializeNotebook] ==== END ====');
        return notebookData;
    }

    /**
     * @description Create default notebook content
     * @param {string[]} allowedUris - List of allowed URIs
     * @param {string} [agentType] - Optional agent type identifier (e.g., 'implementer', 'orchestrator', 'readonly-expert')
     * @param {string[]} activeRules - Optional list of active rules to start with
     * @param {string} [uuid] - Optional UUID for the agent. If not provided, a new UUID will be generated.
     * @param {string[]} [activeSkills] - Optional list of active skills to start with
     * @returns {Uint8Array} Encoded default content
     * @static
     * 
     * @example
     * const content = MutsumiSerializer.createDefaultContent(['/workspace/project'], 'implementer', ['default.md']);
     * await vscode.workspace.fs.writeFile(uri, content);
     */
    static createDefaultContent(
        allowedUris: string[], 
        agentType: string,
        activeRules?: string[], 
        uuid?: string, 
        activeSkills?: string[]
    ): Uint8Array {
        // Resolve agent type defaults using centralized resolver
        const defaults = resolveAgentDefaults(agentType, {
            rules: activeRules,
            skills: activeSkills
        });

        const raw: AgentContext = {
            metadata: {
                uuid: uuid ?? uuidv4(),
                name: 'New Agent',
                created_at: new Date().toISOString(),
                parent_agent_id: null,
                allowed_uris: allowedUris,
                model: defaults.model,
                contextItems: [],
                activeRules: defaults.rules,
                activeSkills: defaults.skills,
                agentType: agentType
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
        debugLogger.log('[serializeNotebook] ==== START ====');
        debugLogger.log(`[serializeNotebook] Input: ${data.cells.length} cells`);

        // Convert VSCode cells to generic cells
        const genericCells: GenericCellData[] = data.cells.map((cell, idx) => {
            debugLogger.log(`[serializeNotebook] Cell ${idx}: kind=${cell.kind}, metadata role=${cell.metadata?.role}, value length=${cell.value?.length ?? 0}`);
            return {
                kind: cell.kind === vscode.NotebookCellKind.Code ? 2 : 1,
                value: cell.value,
                metadata: cell.metadata as GenericCellData['metadata']
            };
        });

        // Use generic conversion
        debugLogger.log(`[serializeNotebook] Converting ${genericCells.length} generic cells to messages...`);
        const context = genericCellsToMessages(genericCells);
        debugLogger.log(`[serializeNotebook] Generated ${context.length} messages`);
        context.forEach((msg, idx) => {
            debugLogger.log(`[serializeNotebook] Message ${idx}: role=${msg.role}, content length=${typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length}`);
        });

        // Build metadata with sub_agents_list from agentRegistry
        // This ensures the relationship is only persisted when this agent is saved,
        // not when child agents are created
        const metadata = { ...data.metadata } as AgentMetadata;
        if (metadata.uuid) {
            const agent = AgentOrchestrator.getInstance().getAgentById(metadata.uuid);
            if (agent?.childIds) {
                metadata.sub_agents_list = Array.from(agent.childIds);
                debugLogger.log(`[serializeNotebook] Synced sub_agents_list: ${metadata.sub_agents_list.length} items`);
            }
        }

        const output: AgentContext = {
            metadata,
            context
        };

        const encoded = new TextEncoder().encode(JSON.stringify(output, null, 2));
        debugLogger.log(`[serializeNotebook] ==== END, output size: ${encoded.length} bytes ====`);
        return encoded;
    }

}
