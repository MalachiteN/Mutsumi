/**
 * @fileoverview Utility functions for the Mutsumi VSCode extension.
 * @module utils
 */

import * as vscode from 'vscode';

/**
 * Provider interface using snake_case for configuration schema alignment.
 */
interface Provider {
    name: string;
    baseurl: string;
    api_key: string;
}

/**
 * Default providers used when user hasn't configured any providers.
 */
const DEFAULT_PROVIDERS: Provider[] = [
    { name: "kimi-for-coding", baseurl: "https://api.kimi.com/coding/v1", api_key: "" }
];

/**
 * Default models configuration used when user hasn't configured any models.
 * @description Values are provider names (from mutsumi.providers or DEFAULT_PROVIDERS).
 */
const DEFAULT_MODELS: Record<string, string> = {
    "kimi-for-coding": "kimi-for-coding"
};

/**
 * Gets the provider credentials for a given model.
 * @description Looks up the model's associated provider and returns the
 * provider's API key and base URL. Performs validation including checking
 * for duplicate provider names and ensuring all required fields are present.
 * @param {string} modelName - The model identifier to look up
 * @returns {{ apiKey: string; baseUrl: string }} Provider credentials with camelCase property names
 * @throws {Error} If provider not found, duplicate names exist, or required fields are empty
 * @example
 * const { apiKey, baseUrl } = getModelCredentials('moonshotai/kimi-k2.5');
 */
export function getModelCredentials(modelName: string): { apiKey: string; baseUrl: string } {
    const config = vscode.workspace.getConfiguration('mutsumi');
    
    // Load providers and models
    let providers = config.get<Provider[]>('providers', []);
    const models = getModelsConfig();
    
    // Use default providers if array is empty
    if (providers.length === 0) {
        providers = DEFAULT_PROVIDERS;
    }
    
    // Check for duplicate provider names after trimming
    const seenNames = new Set<string>();
    for (const provider of providers) {
        const trimmedName = provider.name.trim();
        if (seenNames.has(trimmedName)) {
            throw new Error(`Duplicate provider name after normalization: "${trimmedName}"`);
        }
        seenNames.add(trimmedName);
    }
    
    // Look up the model's provider
    const providerName = models[modelName]?.trim();
    if (!providerName) {
        throw new Error(`Model "${modelName}" not found in configuration`);
    }
    
    // Find the provider (trimmed name comparison)
    const provider = providers.find(p => p.name.trim() === providerName);
    if (!provider) {
        throw new Error(`Provider "${providerName}" for model "${modelName}" not found`);
    }
    
    // Validate baseurl is non-empty after trimming
    const baseUrl = provider.baseurl.trim();
    if (!baseUrl) {
        throw new Error(`Provider "${providerName}" has empty baseurl`);
    }
    
    // Validate api_key is non-empty
    const apiKey = provider.api_key;
    if (!apiKey) {
        throw new Error(`Provider "${providerName}" has empty api_key`);
    }
    
    // Return credentials with camelCase property names
    return {
        apiKey: apiKey,
        baseUrl: baseUrl
    };
}

/**
 * Gets the models configuration from VS Code settings.
 * @description Returns user-configured models if available, otherwise returns
 * the built-in default models. This allows users to override defaults by
 * configuring the mutsumi.models setting.
 * @returns {Record<string, string>} Models configuration (model name -> provider name)
 * @example
 * const models = getModelsConfig();
 * console.log(Object.keys(models)); // ['moonshotai/kimi-k2.5', ...]
 */
export function getModelsConfig(): Record<string, string> {
    const config = vscode.workspace.getConfiguration('mutsumi');
    const models = config.get<Record<string, string>>('models', {});
    
    // If user has configured models (non-empty object), use them
    if (Object.keys(models).length > 0) {
        return models;
    }
    
    // Otherwise return default models
    return DEFAULT_MODELS;
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

/**
 * Wraps multi-line HTML content in a themed container with rounded corners and semi-transparent background.
 * @description Creates a responsive container that appears light in dark themes and dark in light themes,
 * using CSS variables and backdrop-filter for adaptive styling.
 * The container width is determined by the longest line of content (inline-block behavior).
 * @param {string} content - The HTML/multi-line string content to wrap
 * @returns {string} Wrapped HTML string with themed container
 * @example
 * const wrapped = wrapInThemedContainer(`<p>Tool output here</p>`);
 * // Returns HTML with adaptive background styling
 */
export function wrapInThemedContainer(content: string): string {
    if (!content || content.trim().length === 0) {
        return '';
    }
    return `<div style="background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.15)); padding: 12px 16px; border-radius: 8px; margin: 8px 0; display: block; width: fit-content; max-width: 90%;">${content}</div>`;
}

/**
 * Get language identifier for Markdown code block based on file extension
 */
export function getLanguageIdentifier(ext: string): string {
    const langMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'tsx',
        'js': 'javascript',
        'jsx': 'jsx',
        'py': 'python',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust',
        'java': 'java',
        'kt': 'kotlin',
        'swift': 'swift',
        'c': 'c',
        'cpp': 'cpp',
        'cc': 'cpp',
        'h': 'c',
        'hpp': 'cpp',
        'cs': 'csharp',
        'php': 'php',
        'html': 'html',
        'htm': 'html',
        'css': 'css',
        'scss': 'scss',
        'sass': 'sass',
        'less': 'less',
        'json': 'json',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'md': 'markdown',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'zsh',
        'fish': 'fish',
        'ps1': 'powershell',
        'sql': 'sql',
        'dockerfile': 'dockerfile',
        'makefile': 'makefile',
        'vue': 'vue',
        'svelte': 'svelte',
        'astro': 'astro'
    };
    return langMap[ext.toLowerCase()] || '';
}
