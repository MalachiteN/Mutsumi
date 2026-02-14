/**
 * @fileoverview Title generator for notebooks based on conversation content.
 * @module titleGenerator
 */

import * as vscode from 'vscode';
import { AgentMessage } from '../types';
import { LLMClient, LLMClientConfig } from './llmClient';
import { AgentOrchestrator } from './agentOrchestrator';

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
 * Splits a conversation into rounds based on user prompts.
 * @description Each round starts with a user message and ends before the next user message.
 * @private
 * @param {AgentMessage[]} messages - Complete message history
 * @returns {AgentMessage[][]} Array of message arrays, each representing one conversation round
 */
function splitIntoRounds(messages: AgentMessage[]): AgentMessage[][] {
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

    return rounds;
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
 * Generates a concise title based on conversation context.
 * @param {AgentMessage[]} messages - Conversation message history
 * @param {LLMClientConfig} config - LLM client configuration
 * @returns {Promise<string>} Generated title string
 */
export async function generateTitle(
    messages: AgentMessage[],
    config: LLMClientConfig
): Promise<string> {
    const client = new LLMClient(config);

    const rounds = splitIntoRounds(messages);
    const recentRounds = rounds.length <= 6 ? rounds : rounds.slice(-6);
    const contextMessages = recentRounds.flat();
    const contextJson = JSON.stringify(contextMessages, null, 2);

    const result = await client.chatCompletion({
        messages: [
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
        ],
        temperature: 0.7,
        max_tokens: 50
    });

    let title = result.content?.trim() || 'New Agent';
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
    const newMetadata = { ...notebook.metadata, name: title };
    const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
    edit.set(notebook.uri, [nbEdit]);
    await vscode.workspace.applyEdit(edit);

    const uuid = notebook.metadata?.uuid;
    if (uuid) {
        AgentOrchestrator.getInstance().updateAgentName(uuid, title);
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
     * Generates a title for the notebook and updates its metadata.
     * @param {vscode.NotebookDocument} notebook - The notebook document
     * @param {AgentMessage[]} messages - Conversation message history
     * @param {TitleGeneratorConfig} config - Configuration for title generation
     * @returns {Promise<string | undefined>} The generated title or undefined if failed/not configured
     */
    async generateTitleForNotebook(
        notebook: vscode.NotebookDocument,
        messages: AgentMessage[],
        config: TitleGeneratorConfig
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

            await updateNotebookMetadataWithSync(notebook, title);
            return title;
        } catch (error) {
            console.error('Failed to generate notebook title:', error);
            return undefined;
        }
    }
}

/**
 * Regenerates the title for a notebook manually (used by command 'mutsumi.regenerateTitle').
 * @description Manually triggers title generation with strict validation.
 * @param {vscode.NotebookDocument} notebook - The notebook document
 * @returns {Promise<string>} The generated title
 * @throws {Error} If configuration is missing or no messages found
 */
export async function regenerateTitleForNotebook(
    notebook: vscode.NotebookDocument
): Promise<string> {
    const config = getTitleGeneratorConfig();
    
    if (!config.apiKey) {
        throw new Error('Please set mutsumi.apiKey in VSCode Settings.');
    }
    if (!config.titleGeneratorModel) {
        throw new Error('Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel in VSCode Settings.');
    }

    const messages = extractMessagesFromNotebook(notebook);
    if (messages.length === 0) {
        throw new Error('No conversation context found.');
    }

    const title = await generateTitle(messages, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.titleGeneratorModel
    });

    await updateNotebookMetadataWithSync(notebook, title);
    return title;
}
