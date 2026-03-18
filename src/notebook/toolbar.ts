/**
 * @fileoverview Toolbar commands registration for Mutsumi notebook.
 * @module notebook/toolbar
 */

import * as vscode from 'vscode';
import { regenerateTitleForSession, extractMessagesFromNotebook, getTitleGeneratorConfig } from '../agent/titleGenerator';
import { LiteAdapter, LiteAgentSessionConfig } from '../adapters/liteAdapter';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import { buildInteractionHistory } from '../contextManagement/history';
import { toggleAutoApprove, isAutoApproveEnabled } from '../tools.d/permission';
import { RagService } from '../codebase/rag/service';
import { IAgentSession } from '../adapters/interfaces';
import { AgentMessage, AgentMetadata } from '../types';
import { createEmptyToolSet } from '../tools.d/toolManager';
import type { AgentRunOptions } from '../agent/types';
import { MutsumiSerializer } from './serializer';
import { TextEncoder } from 'util';
/**
 * Format an array of AgentMessage into a readable string representation.
 * Used for debugging and displaying conversation context.
 * @param messages - Array of agent messages to format
 * @param options - Formatting options
 * @returns Formatted string
 */
function formatMessagesToString(
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
 * Create a LiteAgentSession from notebook data for debug purposes.
 * This allows using buildInteractionHistory without a full execution context.
 */
async function createDebugSessionFromNotebook(
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
            } // tool 呢？
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

/**
 * Registers all toolbar-related commands for Mutsumi notebooks.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerToolbarCommands(context: vscode.ExtensionContext): void {
    // Model selection command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.selectModel', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }
            
            const config = vscode.workspace.getConfiguration('mutsumi');
            const modelsConfig = config.get<Record<string, string>>('models', {});
            const modelNames = Object.keys(modelsConfig);
            
            if (modelNames.length === 0) {
                vscode.window.showErrorMessage('No models configured in settings.');
                return;
            }
            
            const currentModel = editor.notebook.metadata?.model;

            const items = modelNames.map(name => {
                const label = modelsConfig[name];
                const description = label ? `🏷️ ${label}` : undefined;
                const detail = name === currentModel ? '$(check) Current' : undefined;
                return {
                    label: name,
                    description,
                    detail,
                    picked: name === currentModel
                };
            });
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select model for this agent (current: ${currentModel || 'default'})`
            });
            
            if (selected) {
                // Use in-memory metadata as base to preserve unsaved changes
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, model: selected.label };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
                
                vscode.window.showInformationMessage(`Model changed to: ${selected.label}`);
            }
        })
    );

    // Regenerate title command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.regenerateTitle', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }

            try {
                const messages = extractMessagesFromNotebook(editor.notebook);
                const config = getTitleGeneratorConfig();

                const adapter = new LiteAdapter();
                const liteConfig: LiteAgentSessionConfig = {
                    model: editor.notebook.metadata?.model,
                    metadata: editor.notebook.metadata 
                        ? JSON.parse(JSON.stringify(editor.notebook.metadata)) as any 
                        : undefined,
                    history: messages
                };
                const session = await adapter.createSession({
                    sessionId: editor.notebook.metadata?.uuid || editor.notebook.uri.toString(),
                    config: liteConfig
                });

                const title = await regenerateTitleForSession(session, messages, config, editor.notebook);
                vscode.window.showInformationMessage(`Title regenerated: ${title}`);
            } catch (error: any) {
                console.error('Failed to regenerate title:', error);
                vscode.window.showErrorMessage(`Failed to regenerate title: ${error.message}`);
            }
        })
    );

    // Debug Context command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.debugContext', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }

            const cells = editor.notebook.getCells();
            let lastCodeCellIndex = -1;
            for (let i = cells.length - 1; i >= 0; i--) {
                if (cells[i].kind === vscode.NotebookCellKind.Code) {
                    lastCodeCellIndex = i;
                    break;
                }
            }

            if (lastCodeCellIndex === -1) {
                vscode.window.showWarningMessage('No code cell found in notebook.');
                return;
            }

            try {
                const session = await createDebugSessionFromNotebook(editor.notebook, lastCodeCellIndex);
                const { messages } = await buildInteractionHistory(session);

                // Build content for temporary document
                let content = '=== Complete LLM Context Debug Output ===\n\n';
                content += `Notebook: ${editor.notebook.uri.path}\n`;
                content += `Last Executed Cell: ${lastCodeCellIndex}\n\n`;
                content += formatMessagesToString(messages, { includeHeader: true });
                content += '=== End of Context ===\n';

                // Create and show temporary document
                const doc = await vscode.workspace.openTextDocument({
                    content: content,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });

                vscode.window.showInformationMessage(`Debug context displayed. Total messages: ${messages.length}`);
            } catch (error) {
                console.error('Failed to debug context:', error);
                vscode.window.showErrorMessage(`Failed to debug context: ${error}`);
            }
        })
    );

    // Helper: Get all available rules from .mutsumi/rules directory
    async function getAvailableRules(): Promise<string[]> {
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders) return [];
        
        const root = wsFolders[0].uri;
        const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');

        try {
            const entries = await vscode.workspace.fs.readDirectory(rulesDir);
            return entries
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                .map(([name]) => name);
        } catch {
            return [];
        }
    }

    // Helper: Save active rules to notebook metadata
    async function saveActiveRules(editor: vscode.NotebookEditor, rules: string[]): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const newMetadata = { ...editor.notebook.metadata, activeRules: rules };
        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
        edit.set(editor.notebook.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);
    }

    // Toggle auto approve command (OFF -> ON)
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApprove', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage('Auto-approve mode is now ON. Tools will be executed without confirmation.');
                } else {
                    vscode.window.showInformationMessage('Auto-approve mode is now OFF. Tools will require confirmation.');
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(`Failed to toggle auto-approve: ${error}`);
            }
        })
    );

    // Toggle auto approve command (ON -> OFF) - same command but different icon
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApproveOn', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage('Auto-approve mode is now ON. Tools will be executed without confirmation.');
                } else {
                    vscode.window.showInformationMessage('Auto-approve mode is now OFF. Tools will require confirmation.');
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(`Failed to toggle auto-approve: ${error}`);
            }
        })
    );

    // Set initial context for auto-approve state
    void vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', isAutoApproveEnabled());

    // Sync toolbar context when auto-approve config changes (cross-window update)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mutsumi.autoApproveEnabled')) {
                void vscode.commands.executeCommand(
                    'setContext',
                    'mutsumi:autoApproveEnabled',
                    isAutoApproveEnabled()
                );
            }
        })
    );

    // Test RAG Search command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.testRagSearch', async () => {
            // 获取查询输入
            const query = await vscode.window.showInputBox({
                prompt: 'Enter natural language query for RAG search',
                placeHolder: 'e.g., "how to handle file operations"',
                ignoreFocusOut: true
            });

            if (!query || !query.trim()) {
                vscode.window.showInformationMessage('Search cancelled or empty query.');
                return;
            }

            try {
                const ragService = await RagService.getInstance(context);
                const workspaces = vscode.workspace.workspaceFolders;

                if (!workspaces || workspaces.length === 0) {
                    vscode.window.showWarningMessage('No workspace folders open.');
                    return;
                }

                // 构建内容
                let content = '=== RAG Search Results ===\n\n';
                content += `Query: "${query}"\n`;
                content += `Workspaces searched: ${workspaces.length}\n\n`;

                // 从每个工作区搜索
                for (const ws of workspaces) {
                    content += `--- Workspace: ${ws.name} (${ws.uri.toString()}) ---\n\n`;
                    
                    try {
                        const results = await ragService.search(ws.uri, query, 5);
                        
                        if (results.length === 0) {
                            content += '(No results found)\n';
                        } else {
                            for (let i = 0; i < results.length; i++) {
                                const r = results[i];
                                // 与 embedding 格式一致：文件路径 - 命名空间路径
                                const fullPath = r.symbolName ? `${r.filePath} - ${r.symbolName}` : r.filePath;
                                content += `[${i + 1}] ${fullPath}\n`;
                                content += `    (lines ${r.startLine}-${r.endLine}, distance: ${r.distance.toFixed(4)})\n`;
                                content += '```\n';
                                content += r.text.substring(0, 500);
                                if (r.text.length > 500) {
                                    content += '\n...(truncated)';
                                }
                                content += '\n```\n\n';
                            }
                        }
                    } catch (err: any) {
                        content += `(Error: ${err.message})\n`;
                    }
                    
                    content += '\n';
                }

                content += '=== End of Results ===\n';

                // 创建并显示临时文档
                const doc = await vscode.workspace.openTextDocument({
                    content: content,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });

                vscode.window.showInformationMessage(`RAG search completed across ${workspaces.length} workspace(s).`);
            } catch (error: any) {
                console.error('RAG search failed:', error);
                vscode.window.showErrorMessage(`RAG search failed: ${error.message}`);
            }
        })
    );

    // Compress Conversation command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.compressConversation', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }

            const cells = editor.notebook.getCells();
            let lastCodeCellIndex = -1;
            for (let i = cells.length - 1; i >= 0; i--) {
                if (cells[i].kind === vscode.NotebookCellKind.Code) {
                    lastCodeCellIndex = i;
                    break;
                }
            }

            if (lastCodeCellIndex === -1) {
                vscode.window.showWarningMessage('No code cell found in notebook.');
                return;
            }

            try {
                // Get configuration for compression
                const config = vscode.workspace.getConfiguration('mutsumi');
                const compressModel = config.get<string>('compressModel') || config.get<string>('titleGeneratorModel') || config.get<string>('defaultModel');
                const apiKey = config.get<string>('apiKey');
                const baseUrl = config.get<string>('baseUrl');

                if (!compressModel || !apiKey) {
                    vscode.window.showErrorMessage('Please configure mutsumi.apiKey and mutsumi.compressModel (or defaultModel) in settings.');
                    return;
                }

                // Build session and get full interaction history
                const session = await createDebugSessionFromNotebook(editor.notebook, lastCodeCellIndex);
                const { messages } = await buildInteractionHistory(session);

                if (messages.length <= 1) {
                    vscode.window.showWarningMessage('Not enough conversation content to compress.');
                    return;
                }

                // Show progress
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Compressing conversation...',
                    cancellable: false
                }, async () => {
                    // Dynamically import AgentRunner to avoid circular dependency
                    const { AgentRunner } = await import('../agent/agentRunner.js');

                    // Format messages for compression using the shared utility
                    const conversationText = formatMessagesToString(messages, { includeHeader: false, maxContentLength: 3000 });

                    // Create compression prompt messages
                    const compressionMessages: AgentMessage[] = [
                        {
                            role: 'system',
                            content: 'You are a conversation compression assistant. Your task is to compress a long conversation into a concise summary while preserving all important information, decisions, and context.\n\n' +
                                'Requirements:\n' +
                                '1. Summarize the main topics and goals discussed\n' +
                                '2. Preserve all key decisions and conclusions\n' +
                                '3. Include important code snippets or technical details (in markdown code blocks)\n' +
                                '4. Maintain the chronological flow of the conversation\n' +
                                '5. Keep the summary concise but comprehensive\n' +
                                '6. Use markdown formatting for clarity\n' +
                                '7. Do not include meta-commentary about the compression process'
                        },
                        {
                            role: 'user',
                            content: `Please compress the following conversation into a concise summary:\n\n${conversationText}`
                        }
                    ];

                    // Create lite adapter and session for compression
                    const adapter = new LiteAdapter();
                    const compressConfig: LiteAgentSessionConfig = {
                        model: compressModel,
                        apiKey,
                        baseUrl,
                        metadata: editor.notebook.metadata 
                            ? JSON.parse(JSON.stringify(editor.notebook.metadata)) as AgentMetadata 
                            : undefined
                    };
                    const compressSession = await adapter.createSession({
                        config: compressConfig
                    });

                    // Create empty tool set (no tools = single round)
                    const emptyToolSet = createEmptyToolSet();

                    // Create agent runner
                    const runOptions: AgentRunOptions = {
                        model: compressModel,
                        apiKey,
                        baseUrl,
                        maxLoops: 1 // Single round since no tools
                    };
                    const runner = new AgentRunner(runOptions, emptyToolSet, compressSession);

                    // Run compression
                    const abortController = new AbortController();
                    const compressedMessages = await runner.run(abortController, compressionMessages);

                    // Extract compressed content
                    const lastAssistantMsg = [...compressedMessages].reverse().find(m => m.role === 'assistant');
                    if (!lastAssistantMsg?.content) {
                        throw new Error('Compression failed: no response from LLM');
                    }

                    const compressedContent = typeof lastAssistantMsg.content === 'string' 
                        ? lastAssistantMsg.content 
                        : JSON.stringify(lastAssistantMsg.content);

                    // Generate new file name
                    const originalUri = editor.notebook.uri;
                    const originalName = originalUri.path.split('/').pop() || 'compressed.mtm';
                    const baseName = originalName.replace(/\.mtm$/, '');
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
                    const newFileName = `${baseName}-compressed-${timestamp}.mtm`;

                    // Determine save location (same directory as original)
                    const parentDir = originalUri.with({ path: originalUri.path.substring(0, originalUri.path.lastIndexOf('/')) });
                    const newUri = vscode.Uri.joinPath(parentDir, newFileName);

                    // Create compressed notebook data
                    const originalMetadata = editor.notebook.metadata as AgentMetadata;
                    const { v4: uuidv4 } = await import('uuid');
                    const compressedMetadata: AgentMetadata = {
                        ...originalMetadata,
                        uuid: uuidv4(),
                        name: `${originalMetadata?.name || 'Compressed'} (Compressed)`,
                        created_at: new Date().toISOString(),
                        parent_agent_id: null
                    };

                    // Create single user message with compressed content
                    const compressedContext: AgentMessage[] = [{
                        role: 'user',
                        content: `## Conversation Summary\n\n${compressedContent}\n\n---\n\n*This is a compressed version of the original conversation. Original file: ${originalName}*`
                    }];

                    // Create notebook data using serializer
                    const serializer = new MutsumiSerializer();
                    const notebookData = new vscode.NotebookData([
                        new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            compressedContext[0].content as string,
                            'markdown'
                        )
                    ]);
                    notebookData.metadata = compressedMetadata;

                    // Serialize and save
                    const tokenSource = new vscode.CancellationTokenSource();
                    const bytes = await serializer.serializeNotebook(notebookData, tokenSource.token);
                    await vscode.workspace.fs.writeFile(newUri, bytes);

                    // Open the new file
                    const doc = await vscode.workspace.openNotebookDocument(newUri);
                    await vscode.window.showNotebookDocument(doc);

                    vscode.window.showInformationMessage(`Conversation compressed and saved to: ${newFileName}`);
                });
            } catch (error: any) {
                console.error('Failed to compress conversation:', error);
                vscode.window.showErrorMessage(`Failed to compress conversation: ${error.message}`);
            }
        })
    );
}
