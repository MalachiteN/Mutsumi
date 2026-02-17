import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContextItem } from '../types';
import { getSystemPrompt, getRulesContext } from './prompts';
import { TemplateEngine } from './templateEngine';
import { ContextPresenter } from './contextPresenter';
import {
    parseUserMessageWithImages,
    stripGhostBlock,
    extractMacroDefinitions
} from './utils';

/**
 * @description Build Agent's conversation history context
 */
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }> {
    const messages: AgentMessage[] = [];
    
    // Get metadata
    const metadata = notebook.metadata as AgentMetadata;
    const allowedUris = metadata.allowed_uris || ['/'];
    const isSubAgent = !!metadata.parent_agent_id;
    const wsUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : notebook.uri;
    
    // 1. Static System Prompt
    const systemPromptContent = await getSystemPrompt(wsUri, allowedUris, isSubAgent);
    messages.push({
        role: 'system',
        content: systemPromptContent
    });

    // 2. Prepare Context Map (Accumulate all contexts here)
    const contextMap = new Map<string, ContextItem>();

    // Helper to merge items into map
    const mergeItems = (items: ContextItem[]) => {
        for (const item of items) {
            let uniqueKey = item.key;
            if (item.type === 'tool') {
                uniqueKey = `${item.key}:${JSON.stringify(item.metadata)}`;
            }
            contextMap.set(uniqueKey, item);
        }
    };

    // Extract macros from current prompt
    const macros = extractMacroDefinitions(currentPrompt);

    // 2a. Load Persisted Context (Files from Notebook Metadata) - Note: We don't need to "refresh" content here
    //      because we'll reconstruct the context anyway when building the final message.
    //      We'll just load the existing items for metadata update later.
    const persistedItems: ContextItem[] = metadata.contextItems || [];
    
    for (const item of persistedItems) {
        if (item.type === 'file') {
            contextMap.set(item.key, item);
        }
    }

    // 2b. Parse Current Prompt using TemplateEngine (APPEND mode)
    const { renderedText: processedPrompt, collectedItems: currentContext } = await TemplateEngine.render(
        currentPrompt,
        macros,
        wsUri,
        allowedUris,
        'APPEND'
    );
    mergeItems(currentContext);

    // 2c. Update Notebook Metadata (Persist only file contexts)
    const newContextItems = Array.from(contextMap.values()).filter(item => item.type === 'file');
    
    const edit = new vscode.WorkspaceEdit();
    const newMetadata = {
        ...metadata,
        contextItems: newContextItems
    };
    const notebookEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
    edit.set(notebook.uri, [notebookEdit]);
    await vscode.workspace.applyEdit(edit);

    // 3. Build Message History
    for (let i = 0; i < currentCellIndex; i++) {
        const prevCell = notebook.cellAt(i);
        const role = prevCell.metadata?.role || 'user';
        const content = prevCell.document.getText();
        
        if (content.trim()) {
            if (role === 'user') {
                const multiModalContent = await parseUserMessageWithImages(content);
                const cleanContent = stripGhostBlock(multiModalContent);
                messages.push({ role: 'user', content: cleanContent });
            } else {
                messages.push({ role: role as any, content });
            }
        }

        if (prevCell.metadata?.mutsumi_interaction) {
            const interaction = prevCell.metadata.mutsumi_interaction as AgentMessage[];
            messages.push(...interaction);
        }
    }

    // 4. Assemble Final User Message with Ghost Block using ContextPresenter.format
    const currentMultiModalContent = await parseUserMessageWithImages(processedPrompt);
    
    const contextList = Array.from(contextMap.values());
    const activeRules = metadata.activeRules;
    const rulesItems = await getRulesContext(wsUri, allowedUris, activeRules, macros);
    
    const ghostBlock = ContextPresenter.format(rulesItems, contextList);

    if (ghostBlock) {
        if (Array.isArray(currentMultiModalContent)) {
            currentMultiModalContent.push({ type: 'text', text: ghostBlock });
            messages.push({ role: 'user', content: currentMultiModalContent });
        } else {
            messages.push({ role: 'user', content: currentMultiModalContent + ghostBlock });
        }
    } else {
        messages.push({ role: 'user', content: currentMultiModalContent });
    }

    return { messages, allowedUris, isSubAgent };
}
