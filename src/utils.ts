/**
 * @fileoverview Utility functions for the Mutsumi VSCode extension.
 * @module utils
 */

import OpenAI from 'openai';
import { AgentMessage } from './types';

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
 * Generates a concise title based on conversation context.
 * @description Uses an LLM to analyze recent conversation rounds and generate
 * a descriptive title summarizing the discussion topic.
 * @param {AgentMessage[]} messages - Conversation message history
 * @param {string} apiKey - OpenAI API key
 * @param {string | undefined} baseUrl - OpenAI base URL (optional)
 * @param {string} model - Model identifier to use for title generation
 * @returns {Promise<string>} Generated title string
 * @throws {Error} If the API call fails
 * @example
 * const title = await generateTitle(messages, 'sk-...', undefined, 'gpt-4');
 * console.log(title); // "Database Schema Design"
 */
export async function generateTitle(
    messages: AgentMessage[],
    apiKey: string,
    baseUrl: string | undefined,
    model: string
): Promise<string> {
    const openai = new OpenAI({
        apiKey,
        baseURL: baseUrl,
        defaultHeaders: { 'Client-Name': 'Mutsumi-VSCode' }
    });

    const rounds = splitIntoRounds(messages);
    const recentRounds = rounds.length <= 6 ? rounds : rounds.slice(-6);
    const contextMessages = recentRounds.flat();
    const contextJson = JSON.stringify(contextMessages, null, 2);

    const response = await openai.chat.completions.create({
        model,
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

    let title = response.choices[0]?.message?.content?.trim() || 'New Agent';
    title = sanitizeFileName(title);
    
    if (title.length > 30) {
        title = title.substring(0, 30);
    }
    
    return title || 'New Agent';
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
export function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Ensures a file name is unique by appending a numeric suffix if needed.
 * @description Checks against existing names and generates a unique variant
 * by adding "-1", "-2", etc. as needed.
 * @param {string} baseName - Base file name without extension
 * @param {string[]} existingNames - Array of existing file names to check against
 * @returns {string} Unique file name
 * @example
 * const unique = ensureUniqueFileName('agent', ['agent', 'agent-1']);
 * console.log(unique); // "agent-2"
 */
export function ensureUniqueFileName(baseName: string, existingNames: string[]): string {
    if (!existingNames.includes(baseName)) {
        return baseName;
    }
    
    let counter = 1;
    let newName = `${baseName}-${counter}`;
    
    while (existingNames.includes(newName)) {
        counter++;
        newName = `${baseName}-${counter}`;
    }
    
    return newName;
}
