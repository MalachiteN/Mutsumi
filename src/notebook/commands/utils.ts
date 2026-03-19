/**
 * @fileoverview Utility functions for notebook commands.
 * @module notebook/commands/utils
 */

import * as vscode from 'vscode';
import { IAgentSession } from '../../adapters/interfaces';
import { AgentMessage, AgentMetadata } from '../../types';
import { LiteAdapter, LiteAgentSessionConfig } from '../../adapters/liteAdapter';

/**
 * Format an array of AgentMessage into a readable string representation.
 * Used for debugging and displaying conversation context.
 * @param messages - Array of agent messages to format
 * @param options - Formatting options
 * @returns Formatted string
 */
export function formatMessagesToString(
    messages: AgentMessage[],
    options?: {
        includeHeader?: boolean;
        maxContentLength?: number;
    }
): string {
    const { includeHeader = true, maxContentLength = Infinity } = options || {};
    
    let content = '';
    
    if (includeHeader) {
        content += `Total Messages: ${messages.length}\n\n`;
    }

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        content += `--- Message ${i + 1} [${msg.role.toUpperCase()}] ---\n\n`;
        
        if (typeof msg.content === 'string') {
            const displayContent = maxContentLength < msg.content.length 
                ? msg.content.substring(0, maxContentLength) + '\n...(truncated)'
                : msg.content;
            content += displayContent;
        } else if (Array.isArray(msg.content)) {
            // Handle multi-modal content (text + images)
            for (const part of msg.content) {
                if (part.type === 'text') {
                    const displayText = maxContentLength < part.text.length
                        ? part.text.substring(0, maxContentLength) + '\n...(truncated)'
                        : part.text;
                    content += displayText;
                } else if (part.type === 'image_url') {
                    content += '[Image: ' + (part.image_url?.url?.substring(0, 50) || 'unknown') + '...]';
                }
                content += '\n';
            }
        }
        
        content += '\n\n';
    }

    return content;
}

/**
 * Create a LiteAgentSession from notebook data.
 * This allows using buildInteractionHistory without a full execution context.
 * Used for debug and compression operations.
 */
export async function createDebugSessionFromNotebook(
    notebook: vscode.NotebookDocument,
    cellIndex: number
): Promise<IAgentSession> {
    const metadata = notebook.metadata as AgentMetadata;
    const cell = notebook.cellAt(cellIndex);

    // Build raw history from cells before current
    const history: AgentMessage[] = [];
    for (let i = 0; i < cellIndex; i++) {
        const c = notebook.cellAt(i);
        const role = c.metadata?.role || 'user';
        const content = c.document.getText();

        if (content.trim()) {
            if (role === 'user') {
                history.push({ role: 'user', content });
                // Expand mutsumi_interaction from user cell (contains assistant/tool messages)
                const interaction = c.metadata?.mutsumi_interaction as AgentMessage[] | undefined;
                if (interaction && Array.isArray(interaction)) {
                    history.push(...interaction);
                }
            } else if (role === 'assistant') {
                // Assistant cell content is directly in the cell value
                history.push({ role: 'assistant', content });
            }
        }
    }

    // Collect ghost blocks from previous cells
    const ghostBlocks: string[] = [];
    for (let i = 0; i < cellIndex; i++) {
        const ghostBlock = notebook.cellAt(i).metadata?.last_ghost_block;
        ghostBlocks.push(typeof ghostBlock === 'string' ? ghostBlock : '');
    }

    const adapter = new LiteAdapter();
    const liteConfig: LiteAgentSessionConfig = {
        model: metadata?.model,
        allowedUris: metadata?.allowed_uris,
        isSubAgent: !!metadata?.parent_agent_id,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) as AgentMetadata : undefined,
        input: cell.document.getText(),
        history
    };
    const session = await adapter.createSession({
        sessionId: metadata?.uuid || notebook.uri.toString(),
        config: liteConfig
    });

    // Pre-populate ghost blocks
    for (const gb of ghostBlocks) {
        await session.persistGhostBlock!(gb);
    }

    return session;
}
