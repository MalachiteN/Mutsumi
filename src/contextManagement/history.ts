import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContextItem } from '../types';
import { getSystemPrompt, getRulesContext } from './prompts';
import { TemplateEngine } from './templateEngine';
import { ContextPresenter } from './contextPresenter';
import {
    parseUserMessageWithImages,
    extractMacroDefinitions,
    computeHash
} from './utils';

function collectAvailableFileVersions(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number
): Set<string> {
    const available = new Set<string>();

    for (let i = 0; i < currentCellIndex; i++) {
        const ghostBlock = notebook.cellAt(i).metadata?.last_ghost_block;
        if (!ghostBlock || typeof ghostBlock !== 'string') {
            continue;
        }

        const sections = ghostBlock.split('\n# Source: ');
        for (let s = 1; s < sections.length; s++) {
            const section = sections[s];
            const newlineIndex = section.indexOf('\n');
            const header = (newlineIndex === -1 ? section : section.slice(0, newlineIndex)).trim();

            const match = header.match(/^(.*?)(?:\s*\(v(\d+)\))?$/);
            if (!match) {
                continue;
            }

            const key = match[1].trim();
            const version = match[2] ? Number(match[2]) : undefined;
            if (!key || !version || Number.isNaN(version)) {
                continue;
            }

            const body = newlineIndex === -1 ? '' : section.slice(newlineIndex + 1);
            if (body.includes('> Content unchanged. See previous version')) {
                continue;
            }

            available.add(`${key}::${version}`);
        }
    }

    return available;
}

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
    
    // Extract and merge macros
    // 1. Load persisted macros from metadata
    const persistedMacros = metadata.macroContext || {};
    // 2. Extract new macros from current prompt
    const localMacros = extractMacroDefinitions(currentPrompt);
    // 3. Merge (local overrides persisted)
    const macros = { ...persistedMacros, ...localMacros };

    // 1. Static System Prompt (Now includes Rules)
    const activeRules = metadata.activeRules;
    const rulesItems = await getRulesContext(wsUri, allowedUris, activeRules, macros);
    const systemPromptContent = await getSystemPrompt(wsUri, allowedUris, rulesItems, isSubAgent);
    messages.push({
        role: 'system',
        content: systemPromptContent
    });

    const availableContentVersions = collectAvailableFileVersions(notebook, currentCellIndex);

    // 2. Prepare Context Map & Differential Update
    const persistedItems: ContextItem[] = metadata.contextItems || [];
    const persistedMap = new Map<string, ContextItem>();
    for (const item of persistedItems) {
        if (item.type === 'file') {
            persistedMap.set(item.key, item);
        }
    }

    // 2a. Parse Current Prompt using TemplateEngine (APPEND mode)
    const { renderedText: processedPrompt, collectedItems: currentContext } = await TemplateEngine.render(
        currentPrompt,
        macros,
        wsUri,
        allowedUris,
        'APPEND'
    );

    const finalItemsToDisplay: ContextItem[] = [];
    const newContextItemsForMetadata: ContextItem[] = [...persistedItems];

    for (const item of currentContext) {
        if (item.type === 'file') {
            const currentHash = computeHash(item.content);
            const prevItem = persistedMap.get(item.key);
            
            let version = 1;
            let isModified = true;

            if (prevItem) {
                if (prevItem.lastHash === currentHash) {
                    isModified = false;
                    version = prevItem.version || 1;
                } else {
                    version = (prevItem.version || 0) + 1;
                }
            } else {
                // Check if this file was in persistedItems under a different object reference but same key?
                // persistedMap handles keys. If not in map, it's new.
                version = 1;
            }
            
            // Update item metadata
            item.lastHash = currentHash;
            item.version = version;

            const hasPreviousContent = !isModified && availableContentVersions.has(`${item.key}::${version}`);
            
            if (isModified || !hasPreviousContent) {
                // Full content
                finalItemsToDisplay.push(item);
            } else {
                // Reference only
                const refItem = { ...item };
                refItem.metadata = { ...refItem.metadata, isReference: true };
                finalItemsToDisplay.push(refItem);
            }
            
            // Update global metadata tracking
            const index = newContextItemsForMetadata.findIndex(i => i.key === item.key && i.type === 'file');
            if (index !== -1) {
                newContextItemsForMetadata[index] = item;
            } else {
                newContextItemsForMetadata.push(item);
            }
        } else {
            // Tools are always displayed
            finalItemsToDisplay.push(item);
        }
    }

    // 3. Build Message History
    for (let i = 0; i < currentCellIndex; i++) {
        const prevCell = notebook.cellAt(i);
        const role = prevCell.metadata?.role || 'user';
        const content = prevCell.document.getText();
        
        if (content.trim()) {
            if (role === 'user') {
                const multiModalContent = await parseUserMessageWithImages(content);
                // DO NOT strip ghost block here. 
                // Instead, append the persisted ghost block if it exists in cell metadata.
                const savedGhostBlock = prevCell.metadata?.last_ghost_block || '';
                
                if (savedGhostBlock) {
                    if (Array.isArray(multiModalContent)) {
                        messages.push({ role: 'user', content: [...multiModalContent, { type: 'text', text: savedGhostBlock }] });
                    } else {
                        messages.push({ role: 'user', content: multiModalContent + savedGhostBlock });
                    }
                } else {
                    messages.push({ role: 'user', content: multiModalContent });
                }
            } else {
                messages.push({ role: role as any, content });
            }
        }

        if (prevCell.metadata?.mutsumi_interaction) {
            const interaction = prevCell.metadata.mutsumi_interaction as AgentMessage[];
            messages.push(...interaction);
        }
    }

    // 4. Assemble Final User Message
    // Pass empty array for rules because they are in system prompt
    const ghostBlock = ContextPresenter.format([], finalItemsToDisplay);
    
    // 5. Update Metadata & Current Cell Metadata
    const edit = new vscode.WorkspaceEdit();
    
    // Update Notebook Metadata (Context Items and Macros)
    const newMetadata = {
        ...metadata,
        contextItems: newContextItemsForMetadata,
        macroContext: macros
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
    
    // Update Current Cell Metadata (Persist the Ghost Block we just generated)
    const currentCell = notebook.cellAt(currentCellIndex);
    const newCellMetadata = {
        ...currentCell.metadata,
        last_ghost_block: ghostBlock
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateCellMetadata(currentCellIndex, newCellMetadata)]);

    await vscode.workspace.applyEdit(edit);

    // 6. Push final message
    const currentMultiModalContent = await parseUserMessageWithImages(processedPrompt);
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
