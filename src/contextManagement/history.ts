import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContextItem } from '../types';
import { getSystemPrompt, getRulesContext } from './prompts';
import { ContextAssembler } from './contextAssembler';
import { MacroContext, extractMacroDefinitions } from './preprocessor';
import {
    getLanguageIdentifier,
    readImageAsBase64,
    parseUserMessageWithImages,
    stripGhostBlock,
    GHOST_BLOCK_MARKER
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

    // Extract macro definitions from current user prompt
    const userDefinedMacros = extractMacroDefinitions(currentPrompt);

    // Create shared MacroContext and populate with persisted macros
    const sharedMacroContext = new MacroContext();

    // Load persisted macros from notebook metadata (if any)
    if (metadata.macroContext) {
        sharedMacroContext.setMacros(metadata.macroContext);
    }

    // Override/add with user-defined macros from current prompt
    userDefinedMacros.forEach((value, key) => {
        sharedMacroContext.define(key, value);
    });

    // 1. Static System Prompt
    const systemPromptContent = await getSystemPrompt(wsUri, allowedUris, isSubAgent);
    messages.push({
        role: 'system',
        content: systemPromptContent
    });

    // 2. Prepare Context Map (Accumulate all contexts here)
    // Map key is context item key (e.g. file path or tool call signature)
    const contextMap = new Map<string, ContextItem>();

    // Helper to merge items into map
    const mergeItems = (items: ContextItem[]) => {
        for (const item of items) {
            let uniqueKey = item.key;
            if (item.type === 'tool') {
                // Tools are unique by execution (args)
                uniqueKey = `${item.key}:${JSON.stringify(item.metadata)}`;
            }
            contextMap.set(uniqueKey, item);
        }
    };

    // 2a. Load Global Rules (Dynamic from workspace)
    const rulesItems = await getRulesContext(wsUri, allowedUris, sharedMacroContext);
    mergeItems(rulesItems);

    // 2b. Load Persisted Context (Files & Rules from Notebook Metadata)
    // This represents the "long-term memory" of file references across the session
    const persistedItems: ContextItem[] = metadata.contextItems || [];
    
    // Refresh persisted files to ensure we have latest content
    for (const item of persistedItems) {
        // We only persist files and rules. Tools are not persisted.
        if (item.type === 'file') {
            try {
                // Re-resolve to get fresh content
                const freshItems = await ContextAssembler.resolveContextWithMacros(
                    `@[${item.key}]`,
                    wsUri.fsPath,
                    allowedUris,
                    sharedMacroContext
                );
                if (freshItems.length > 0) {
                    // Update content in map
                    mergeItems(freshItems);
                } else {
                    // Fallback to old content if resolution returns nothing (e.g. file deleted? but we should warn)
                    contextMap.set(item.key, item);
                }
            } catch (e) {
                console.warn(`Failed to refresh file context ${item.key}:`, e);
                // Keep old content if refresh fails
                contextMap.set(item.key, item);
            }
        } else if (item.type === 'rule') {
            // Merge existing rules (unless they were already added by getRulesContext)
            if (!contextMap.has(item.key)) {
                contextMap.set(item.key, item);
            }
        }
        // Implicitly drop tools from persisted history if they somehow got there
    }

    // 2c. Parse Current Prompt for NEW Context
    // This adds any new file references or tool calls from the current user message
    const currentContext = await ContextAssembler.resolveContextWithMacros(
        currentPrompt,
        wsUri.fsPath,
        allowedUris,
        sharedMacroContext
    );
    mergeItems(currentContext);

    // 2d. Update Notebook Metadata (Persist File/Rule Contexts for future turns)
    // We take everything from the map, FILTER OUT TOOLS, and save to metadata.
    // This ensures next time we have all files referenced so far.
    const newContextItems = Array.from(contextMap.values()).filter(item => item.type !== 'tool');
    
    // Check if we need to update metadata (shallow comparison to avoid dirtying if unchanged?)
    // Since file content changes often, we assume update is needed if there are any items.
    // We use WorkspaceEdit to be safe.
    const edit = new vscode.WorkspaceEdit();
    const newMetadata = {
        ...metadata,
        contextItems: newContextItems,
        macroContext: sharedMacroContext.getMacrosObject()
    };
    const notebookEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
    edit.set(notebook.uri, [notebookEdit]);
    await vscode.workspace.applyEdit(edit);

    // 3. Build Message History (Standard, no ghost blocks in history)
    // We iterate through previous cells to build the conversation history string
    for (let i = 0; i < currentCellIndex; i++) {
        const prevCell = notebook.cellAt(i);
        const role = prevCell.metadata?.role || 'user';
        const content = prevCell.document.getText();
        
        if (content.trim()) {
            if (role === 'user') {
                // Add message to history (Clean, without ghost block)
                const multiModalContent = await parseUserMessageWithImages(content);
                // Filter out ghost block if it was accidentally included
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

    // 4. Assemble Final User Message with Ghost Block (Runtime only)
    // This includes ALL context: Rules, Files (refreshed), and Tools (current only)
    const currentMultiModalContent = await parseUserMessageWithImages(currentPrompt);
    
    const contextList = Array.from(contextMap.values());
    if (contextList.length > 0) {
        // Build Markdown formatted context block
        let contextMarkdown = '\n<content_reference>\n';

        // Add Rules
        const rules = contextList.filter(i => i.type === 'rule');
        if(rules.length > 0){
            contextMarkdown += '\n以下是你必须遵守的规则：\n';
        }
        for (const rule of rules) {
            contextMarkdown += `\n# Rule: ${rule.key}\n\n${rule.content}\n`;
        }

        // Add Files (as Markdown code blocks)
        const files = contextList.filter(i => i.type === 'file');
        if(files.length > 0){
            contextMarkdown += '\n以下是用户使用@引用的文件，预插入到此处：\n';
        }
        for (const file of files) {
            const ext = file.key.split('.').pop() || '';
            const lang = getLanguageIdentifier(ext);
            contextMarkdown += `\n# Source: ${file.key}\n\n\`\`\`${lang}\n${file.content}\n\`\`\`\n`;
        }

        // Add Tools
        const tools = contextList.filter(i => i.type === 'tool');
        if(tools.length > 0){
            contextMarkdown += '\n下面是用户使用@指定的工具调用，预执行结果如下：\n';
        }
        for (const tool of tools) {
            contextMarkdown += `\n# Tool Call: ${tool.key}\n> Args: ${JSON.stringify(tool.metadata)}\n\n${tool.content}\n`;
        }

        contextMarkdown += '\n上述规则展开、文件读取、工具调用均已预执行且保证结果最新。请直接使用其结果，无需重复\n</content_reference>';

        // Append ghost block to content (runtime only, not persisted)
        if (Array.isArray(currentMultiModalContent)) {
            currentMultiModalContent.push({ type: 'text', text: contextMarkdown });
            messages.push({ role: 'user', content: currentMultiModalContent });
        } else {
            messages.push({ role: 'user', content: currentMultiModalContent + contextMarkdown });
        }
    } else {
        messages.push({ role: 'user', content: currentMultiModalContent });
    }

    return { messages, allowedUris, isSubAgent };
}
