/**
 * @fileoverview Utility functions for the Mutsumi VSCode extension.
 * @module utils
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

/**
 * Resolves the better-sqlite3 native binding path for the current platform/arch.
 * @description Returns the absolute path to the bundled `.node` binary when
 * running inside a universal VSIX. If the current platform is unsupported or
 * the binary does not exist, returns `undefined` so better-sqlite3 falls back
 * to its default binding resolution (preserving platform-specific package behavior).
 * @param {string} extensionPath - The extension root path (from `vscode.ExtensionContext.extensionPath`)
 * @returns {string | undefined} Absolute path to the native binary, or undefined to fall back
 */
export function getBetterSqlite3NativeBinding(extensionPath: string): string | undefined {
    const supportedPlatforms = [
        'win32-x64',
        'darwin-arm64',
        'linux-x64',
        'linux-arm64',
    ] as const;

    type SupportedPlatform = typeof supportedPlatforms[number];

    const filenameMap: Record<SupportedPlatform, string> = {
        'win32-x64': 'better_sqlite3-win32-x64.node',
        'darwin-arm64': 'better_sqlite3-darwin-arm64.node',
        'linux-x64': 'better_sqlite3-linux-x64.node',
        'linux-arm64': 'better_sqlite3-linux-arm64.node',
    };

    const platformKey = `${process.platform}-${process.arch}` as SupportedPlatform;
    if (!supportedPlatforms.includes(platformKey)) {
        return undefined;
    }

    const filename = filenameMap[platformKey];
    const nativePath = path.join(extensionPath, 'native', 'better-sqlite3', filename);

    if (!fs.existsSync(nativePath)) {
        return undefined;
    }

    return nativePath;
}
