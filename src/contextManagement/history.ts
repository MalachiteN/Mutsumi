import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContextItem } from '../types';
import { IAgentSession } from '../adapters/interfaces';
import { getSystemPrompt, getRulesContext } from './prompts';
import { TemplateEngine } from './templateEngine';
import { ContextPresenter } from './contextPresenter';
import {
    parseUserMessageWithImages,
    extractMacroDefinitions,
    computeHash
} from './utils';

/**
 * Collect available file versions from previous ghost blocks.
 * Parses ghost blocks to track which file versions have been shown.
 */
function collectAvailableFileVersions(ghostBlocks: string[]): Set<string> {
    const available = new Set<string>();

    for (const ghostBlock of ghostBlocks) {
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
 * @param session - The agent session providing history and persistence
 * @param currentPrompt - Optional current user prompt (if not provided, uses session.getInput())
 * @returns Object containing messages array, allowed URIs, and sub-agent status
 */
export async function buildInteractionHistory(
    session: IAgentSession,
    currentPrompt?: string
): Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }> {
    // Get current prompt from session if not provided
    if (!currentPrompt) {
        currentPrompt = await session.getInput();
    }
    const messages: AgentMessage[] = [];

    // Get config and metadata from session
    const config = await session.getConfig();
    const metadata = config.metadata || {} as AgentMetadata;
    const allowedUris = config.allowedUris || metadata.allowed_uris || ['/'];
    const isSubAgent = config.isSubAgent || !!metadata.parent_agent_id;

    // Get workspace URI
    const wsUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri :
        (config.resourceUri ? vscode.Uri.parse(config.resourceUri) : undefined);

    if (!wsUri) {
        throw new Error('No workspace available for resolving context references');
    }

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

    // Get previous ghost blocks for version tracking
    const previousGhostBlocks = session.getPreviousGhostBlocks
        ? await session.getPreviousGhostBlocks()
        : [];
    const availableContentVersions = collectAvailableFileVersions(previousGhostBlocks);

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

    // 3. Build Message History from session
    const history = await session.getHistory();

    // Track ghost block index separately (only for user messages)
    let ghostBlockIndex = 0;

    // Process raw history - expand interactions and attach ghost blocks
    // NOTE: mutsumi_interaction ONLY exists on user messages, containing the
    // assistant and tool messages that followed that user prompt
    for (const msg of history) {
        if (msg.role === 'user') {
            const multiModalContent = await parseUserMessageWithImages(
                typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            );
            // Append the persisted ghost block if it exists
            const savedGhostBlock = previousGhostBlocks[ghostBlockIndex] || '';
            ghostBlockIndex++;

            if (savedGhostBlock) {
                if (Array.isArray(multiModalContent)) {
                    messages.push({ role: 'user', content: [...multiModalContent, { type: 'text', text: savedGhostBlock }] });
                } else {
                    messages.push({ role: 'user', content: multiModalContent + savedGhostBlock });
                }
            } else {
                messages.push({ role: 'user', content: multiModalContent });
            }

            // Expand mutsumi_interaction from user message metadata
            // This contains the assistant response and any tool calls/results
            const interaction = msg.metadata?.mutsumi_interaction as AgentMessage[] | undefined;
            if (interaction && Array.isArray(interaction)) {
                messages.push(...interaction);
            }
        } else if (msg.role === 'assistant') {
            // Assistant messages in history are standalone (orphan messages without a preceding user)
            // or legacy format. Add them directly.
            messages.push(msg);
        } else if (msg.role === 'system') {
            // Skip, we already added system prompt
            continue;
        } else {
            // tool, etc. - add directly
            messages.push(msg);
        }
    }

    // 4. Assemble Final User Message
    // Pass empty array for rules because they are in system prompt
    const ghostBlock = ContextPresenter.format([], finalItemsToDisplay);

    // 5. Persist context items and ghost block via session
    if (session.updateContextItems) {
        await session.updateContextItems(newContextItemsForMetadata);
    }

    if (session.persistGhostBlock) {
        await session.persistGhostBlock(ghostBlock);
    }

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
