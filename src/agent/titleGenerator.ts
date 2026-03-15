/**
 * @fileoverview Title generator for notebooks based on conversation content.
 * @module titleGenerator
 */

import * as vscode from 'vscode';
import { AgentMessage } from '../types';
import { LLMClient, LLMClientConfig } from './llmClient';
import { AgentOrchestrator } from './agentOrchestrator';
import { IAgentSession } from '../adapters/interfaces';
import { LiteAdapter } from '../adapters/liteAdapter';
import { createEmptyToolSet } from '../tools.d/toolManager';
import type { AgentRunOptions } from './types';

/**
 * Creates a deep clone of an object.
 * @param {T} obj - Object to clone
 * @returns {T} Deep cloned object
 */
function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Configuration interface for title generation.
 * @interface TitleGeneratorConfig
 */
export interface TitleGeneratorConfig {
    /** Model identifier to use for title generation */
    titleGeneratorModel?: string;
    /** OpenAI API key */
    apiKey?: string;
    /** Base URL for OpenAI-compatible API */
    baseUrl?: string;
}

/**
 * Sanitizes a string to be safe for use as a file name.
 * @param {string} name - Original name to sanitize
 * @returns {string} Sanitized name safe for file system use
 */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Creates title generation system and user messages.
 * @param {AgentMessage[]} messages - Conversation message history
 * @returns {AgentMessage[]} Messages for title generation prompt
 */
function createTitleGenerationMessages(messages: AgentMessage[]): AgentMessage[] {
    // Filter out system messages and split into rounds
    const dialogMessages = messages.filter(msg => msg.role !== 'system');
    const rounds: AgentMessage[][] = [];
    let currentRound: AgentMessage[] = [];

    for (const msg of dialogMessages) {
        if (msg.role === 'user') {
            if (currentRound.length > 0) {
                rounds.push(currentRound);
            }
            currentRound = [msg];
        } else {
            currentRound.push(msg);
        }
    }

    if (currentRound.length > 0) {
        rounds.push(currentRound);
    }

    // Take last 6 rounds
    const recentRounds = rounds.length <= 6 ? rounds : rounds.slice(-6);
    const contextMessages = recentRounds.flat();
    const contextJson = JSON.stringify(contextMessages, null, 2);

    return [
        {
            role: 'system',
            content: 'Please generate a short title based on the following conversation content. ' +
                'The title should summarize the main topic of the conversation. ' +
                'Conversation data is provided in JSON format, containing messages from user, assistant, tool roles. ' +
                'Requirements:\n1. Length should be 10-20 characters\n2. No special characters like \\\/:*?"<>|' +
                '\n3. Return only the title text, no explanations or prefixes'
        },
        {
            role: 'user',
            content: `Please generate a title for this conversation:\n\n${contextJson.substring(0, 4000)}`
        }
    ];
}

/**
 * Generates a concise title using an AgentRunner with LiteAdapter and no tools.
 * @description Uses the standard AgentRunner infrastructure with an empty tool set,
 * ensuring single-round execution (since no tools are available).
 * @param {AgentMessage[]} messages - Conversation message history
 * @param {LLMClientConfig} config - LLM client configuration
 * @returns {Promise<string>} Generated title string
 */
export async function generateTitle(
    messages: AgentMessage[],
    config: LLMClientConfig
): Promise<string> {
    // Dynamically import AgentRunner to avoid circular dependency
    const { AgentRunner } = await import('./agentRunner');

    // Create lite adapter and session
    const adapter = new LiteAdapter();
    const session = await adapter.createSession({
        config: {
            model: config.model,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl
        }
    });

    // Create empty tool set (no tools = single round guaranteed)
    const emptyToolSet = createEmptyToolSet();

    // Create runner options
    const runOptions: AgentRunOptions = {
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxLoops: 1 // Extra safety: limit to 1 loop
    };

    // Create agent runner with empty tool set
    const runner = new AgentRunner(runOptions, emptyToolSet, session);

    // Create title generation messages
    const titleMessages = createTitleGenerationMessages(messages);

    // Run the agent (will be single round since no tools)
    const abortController = new AbortController();
    const newMessages = await runner.run(abortController, titleMessages);

    // The last assistant message contains the title
    const lastAssistantMsg = [...newMessages].reverse().find(m => m.role === 'assistant');
    let title = 'New Agent';
    if (lastAssistantMsg?.content && typeof lastAssistantMsg.content === 'string') {
        title = lastAssistantMsg.content.trim();
    }

    // Sanitize the title
    title = sanitizeFileName(title);

    if (title.length > 30) {
        title = title.substring(0, 30);
    }

    return title || 'New Agent';
}

/**
 * Extracts conversation messages from notebook cells.
 * @param {vscode.NotebookDocument} notebook - The notebook document
 * @returns {AgentMessage[]} Array of conversation messages
 */
export function extractMessagesFromNotebook(notebook: vscode.NotebookDocument): AgentMessage[] {
    const messages: AgentMessage[] = [];
    for (const cell of notebook.getCells()) {
        if (cell.kind === vscode.NotebookCellKind.Code) {
            messages.push({ role: 'user', content: cell.document.getText() });
            if (cell.metadata?.mutsumi_interaction) {
                messages.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
            }
        }
    }
    return messages;
}

/**
 * Updates notebook metadata with the generated title and syncs registry.
 * @param {vscode.NotebookDocument} notebook - The notebook document to update
 * @param {string} title - The title to set
 * @returns {Promise<void>}
 */
export async function updateNotebookMetadataWithSync(
    notebook: vscode.NotebookDocument,
    title: string
): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    // Use deep clone to avoid readonly issues with nested objects
    const newMetadata = deepClone({ ...notebook.metadata, name: title });
    const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
    edit.set(notebook.uri, [nbEdit]);
    await vscode.workspace.applyEdit(edit);

    const uuid = notebook.metadata?.uuid;
    if (uuid) {
        const orchestrator = AgentOrchestrator.getInstance();
        orchestrator.updateAgentName(uuid, title);
        orchestrator.refreshUI();
    }
}

/**
 * Gets the title generator configuration from VSCode workspace settings.
 * @returns {TitleGeneratorConfig} Configuration object for title generation
 */
export function getTitleGeneratorConfig(): TitleGeneratorConfig {
    const config = vscode.workspace.getConfiguration('mutsumi');
    return {
        titleGeneratorModel: config.get<string>('titleGeneratorModel'),
        apiKey: config.get<string>('apiKey'),
        baseUrl: config.get<string>('baseUrl')
    };
}

/**
 * Generates titles for notebooks based on conversation content.
 * @description Manages title generation logic, including configuration checks
 * and notebook metadata updates.
 * @class TitleGenerator
 */
export class TitleGenerator {
    /**
     * Checks if title generation is configured and should be performed.
     * @param {TitleGeneratorConfig} config - Configuration object
     * @returns {boolean} True if title generation is properly configured
     */
    shouldGenerateTitle(config: TitleGeneratorConfig): boolean {
        return !!config.titleGeneratorModel && !!config.apiKey;
    }

    /**
     * Generates a title for the session using the adapter-compatible interface.
     * @param {IAgentSession} session - The agent session
     * @param {AgentMessage[]} messages - Conversation message history
     * @param {TitleGeneratorConfig} config - Configuration for title generation
     * @returns {Promise<string | undefined>} The generated title or undefined if failed/not configured
     */
    async generateTitleForSession(
        session: IAgentSession,
        messages: AgentMessage[],
        config: TitleGeneratorConfig,
        notebook?: vscode.NotebookDocument
    ): Promise<string | undefined> {
        if (!this.shouldGenerateTitle(config) || messages.length === 0) {
            return undefined;
        }

        try {
            const title = await generateTitle(messages, {
                apiKey: config.apiKey!,
                baseUrl: config.baseUrl,
                model: config.titleGeneratorModel!
            });

            await session.updateTitle(title);
            // Note: session.updateTitle() already handles metadata update and UI refresh
            // for NotebookAgentSession, so we don't need to call updateNotebookMetadataWithSync here
            return title;
        } catch (error) {
            console.error('Failed to generate session title:', error);
            return undefined;
        }
    }
}

/**
 * Regenerates the title for a session using the adapter-compatible interface.
 * @description Manually triggers title generation with strict validation.
 * @param {IAgentSession} session - The agent session
 * @param {AgentMessage[]} messages - Conversation message history
 * @param {TitleGeneratorConfig} config - Configuration for title generation
 * @returns {Promise<string>} The generated title
 * @throws {Error} If configuration is missing or no messages found
 */
export async function regenerateTitleForSession(
    session: IAgentSession,
    messages: AgentMessage[],
    config: TitleGeneratorConfig,
    notebook?: vscode.NotebookDocument
): Promise<string> {
    if (!config.apiKey) {
        throw new Error('Please set mutsumi.apiKey in VSCode Settings.');
    }
    if (!config.titleGeneratorModel) {
        throw new Error('Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel in VSCode Settings.');
    }

    if (messages.length === 0) {
        throw new Error('No conversation context found.');
    }

    const title = await generateTitle(messages, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.titleGeneratorModel
    });

    await session.updateTitle(title);
    if (notebook) {
        await updateNotebookMetadataWithSync(notebook, title);
    }
    return title;
}
