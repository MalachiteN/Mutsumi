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
 * @example
 * const rounds = splitIntoRounds(messages);
 * // rounds[0] contains first user message and assistant response
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
 * @description Removes or replaces characters that are invalid in file systems
 * and normalizes whitespace.
 * @param {string} name - Original name to sanitize
 * @returns {string} Sanitized name safe for file system use
 * @example
 * const safe = sanitizeFileName('file:name?test');
 * console.log(safe); // "file-name-test"
 */
function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generates a concise title based on conversation context.
 * @description Uses an LLM to analyze recent conversation rounds and generate
 * a descriptive title summarizing the discussion topic.
 * @param {AgentMessage[]} messages - Conversation message history
 * @param {LLMClientConfig} config - LLM client configuration
 * @returns {Promise<string>} Generated title string
 * @throws {Error} If the API call fails
 * @example
 * const title = await generateTitle(messages, {
 *     apiKey: 'sk-...',
 *     baseUrl: undefined,
 *     model: 'gpt-4'
 * });
 * console.log(title); // "Database Schema Design"
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
 * @description Iterates through notebook cells to extract user prompts and
 * assistant/tool responses from cell metadata.
 * @param {vscode.NotebookDocument} notebook - The notebook document
 * @returns {AgentMessage[]} Array of conversation messages
 * @example
 * const messages = extractMessagesFromNotebook(notebook);
 * // Returns [{role: 'user', content: '...'}, {role: 'assistant', content: '...'}, ...]
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
 * @description Applies the title to notebook metadata and updates the agent
 * registry to keep the sidebar UI in sync.
 * @param {vscode.NotebookDocument} notebook - The notebook document to update
 * @param {string} title - The title to set
 * @returns {Promise<void>}
 * @example
 * await updateNotebookMetadataWithSync(notebook, 'New Title');
 */
export async function updateNotebookMetadataWithSync(
    notebook: vscode.NotebookDocument,
    title: string
): Promise<void> {
    // Use in-memory metadata as base to preserve unsaved changes
    const edit = new vscode.WorkspaceEdit();
    const newMetadata = { ...notebook.metadata, name: title };
    const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
    edit.set(notebook.uri, [nbEdit]);
    await vscode.workspace.applyEdit(edit);

    // Sync registry and refresh sidebar UI
    const uuid = notebook.metadata?.uuid;
    if (uuid) {
        AgentOrchestrator.getInstance().updateAgentName(uuid, title);
    }
}

/**
 * Gets the title generator configuration from VSCode workspace settings.
 * @description Reads the mutsumi configuration and extracts title generation related settings.
 * @returns {TitleGeneratorConfig} Configuration object for title generation
 * @example
 * const config = getTitleGeneratorConfig();
 * // Returns: { titleGeneratorModel: 'gpt-4', apiKey: 'sk-...', baseUrl: undefined }
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
 * Validates title generator configuration.
 * @description Checks if required configuration is present and throws descriptive
 * errors if configuration is missing.
 * @param {TitleGeneratorConfig} config - Configuration to validate
 * @throws {Error} If apiKey or titleGeneratorModel is missing
 * @example
 * validateConfig({ apiKey: 'sk-...', titleGeneratorModel: 'gpt-4' }); // Passes
 * validateConfig({}); // Throws 'Please set mutsumi.apiKey...'
 */
export function validateTitleGeneratorConfig(config: TitleGeneratorConfig): void {
    if (!config.apiKey) {
        throw new Error('Please set mutsumi.apiKey in VSCode Settings.');
    }
    if (!config.titleGeneratorModel) {
        throw new Error('Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel in VSCode Settings.');
    }
}

/**
 * Generates titles for notebooks based on conversation content.
 * @description Manages title generation logic, including configuration checks
 * and notebook metadata updates.
 * @class TitleGenerator
 * @example
 * const titleGen = new TitleGenerator();
 * if (titleGen.shouldGenerateTitle(config)) {
 *     await titleGen.generateTitleForNotebook(notebook, messages, config);
 * }
 */
export class TitleGenerator {
    /**
     * Checks if title generation is configured and should be performed.
     * @param {TitleGeneratorConfig} config - Configuration object containing title generation settings
     * @returns {boolean} True if title generation is properly configured
     * @example
     * const shouldGenerate = titleGenerator.shouldGenerateTitle({
     *     titleGeneratorModel: 'gpt-4',
     *     apiKey: 'sk-...'
     * });
     */
    shouldGenerateTitle(config: TitleGeneratorConfig): boolean {
        return !!config.titleGeneratorModel && !!config.apiKey;
    }

    /**
     * Generates a title for the notebook and updates its metadata.
     * @description Uses the conversation messages to generate a descriptive title
     * and updates the notebook's metadata name field. Also syncs the agent registry
     * and refreshes the sidebar UI.
     * @param {vscode.NotebookDocument} notebook - The notebook document to update
     * @param {AgentMessage[]} messages - Conversation message history
     * @param {TitleGeneratorConfig} config - Configuration for title generation
     * @returns {Promise<string | undefined>} The generated title or undefined if failed/not configured
     * @example
     * const title = await titleGenerator.generateTitleForNotebook(
     *     notebook,
     *     messages,
     *     { titleGeneratorModel: 'gpt-4', apiKey: 'sk-...', baseUrl: undefined }
     * );
     */
    async generateTitleForNotebook(
        notebook: vscode.NotebookDocument,
        messages: AgentMessage[],
        config: TitleGeneratorConfig
    ): Promise<string | undefined> {
        if (!this.shouldGenerateTitle(config)) {
            return undefined;
        }

        if (messages.length === 0) {
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
 * Convenience function to generate a title if configured.
 * @description Combines configuration retrieval and title generation into a single call.
 * Returns undefined if not configured or if generation fails.
 * @param {vscode.NotebookDocument} notebook - The notebook document
 * @param {AgentMessage[]} messages - Conversation message history
 * @returns {Promise<string | undefined>} The generated title or undefined if not configured/failed
 * @example
 * const title = await generateTitleIfNeeded(notebook, messages);
 * if (title) {
 *     console.log(`Generated title: ${title}`);
 * }
 */
export async function generateTitleIfNeeded(
    notebook: vscode.NotebookDocument,
    messages: AgentMessage[]
): Promise<string | undefined> {
    const config = getTitleGeneratorConfig();
    const titleGenerator = new TitleGenerator();
    return titleGenerator.generateTitleForNotebook(notebook, messages, config);
}

/**
 * Regenerates the title for a notebook manually.
 * @description This function is used by the command 'mutsumi.regenerateTitle' to
 * manually trigger title generation for the active notebook. It extracts messages
 * from the notebook cells, validates configuration, generates a title, and updates
 * the notebook metadata and agent registry.
 * @param {vscode.NotebookDocument} notebook - The notebook document to regenerate title for
 * @returns {Promise<string>} The generated title
 * @throws {Error} If configuration is missing, no messages found, or API call fails
 * @example
 * // Used in extension.ts command handler
 * const title = await regenerateTitleForNotebook(editor.notebook);
 * vscode.window.showInformationMessage(`Title regenerated: ${title}`);
 */
export async function regenerateTitleForNotebook(
    notebook: vscode.NotebookDocument
): Promise<string> {
    const config = getTitleGeneratorConfig();
    
    // Validate configuration - throws if missing
    validateTitleGeneratorConfig(config);

    // Extract messages from notebook cells
    const messages = extractMessagesFromNotebook(notebook);

    if (messages.length === 0) {
        throw new Error('No conversation context found.');
    }

    // Generate title
    const title = await generateTitle(messages, {
        apiKey: config.apiKey!,
        baseUrl: config.baseUrl,
        model: config.titleGeneratorModel!
    });

    // Update metadata and sync registry
    await updateNotebookMetadataWithSync(notebook, title);

    return title;
}
