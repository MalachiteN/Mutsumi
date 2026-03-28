/**
 * @fileoverview Configuration loader for Mutsumi Agent Type system.
 * @module config/loader
 */

import * as vscode from 'vscode';
import {
    MutsumiConfig,
    AgentTypeConfig,
    DEFAULT_MUTSUMI_CONFIG,
    validateMutsumiConfig,
    ConfigValidationError
} from './types';

/**
 * Configuration file path relative to workspace root.
 */
const CONFIG_FILE_PATH = '.mutsumi/config.json';

/**
 * Deep merge two MutsumiConfig objects.
 * User config overrides built-in defaults, with partial overrides supported.
 * @param defaults - Built-in default configuration
 * @param userConfig - User-provided configuration
 * @returns Merged configuration
 */
function mergeConfig(defaults: MutsumiConfig, userConfig: Partial<MutsumiConfig>): MutsumiConfig {
    // Start with default toolSets
    const mergedToolSets: Record<string, string[]> = { ...defaults.toolSets };
    
    // Merge user toolSets (override completely)
    if (userConfig.toolSets) {
        for (const [name, tools] of Object.entries(userConfig.toolSets)) {
            if (Array.isArray(tools)) {
                mergedToolSets[name] = tools;
            }
        }
    }

    // Start with default agentTypes
    const mergedAgentTypes: Record<string, AgentTypeConfig> = {};
    
    // First copy all defaults
    for (const [name, config] of Object.entries(defaults.agentTypes)) {
        mergedAgentTypes[name] = { ...config };
    }

    // Then merge user agentTypes (override completely or extend)
    if (userConfig.agentTypes) {
        for (const [name, userAgentConfig] of Object.entries(userConfig.agentTypes)) {
            if (userAgentConfig && typeof userAgentConfig === 'object') {
                // If it's an existing type, merge with defaults
                if (mergedAgentTypes[name]) {
                    mergedAgentTypes[name] = {
                        ...mergedAgentTypes[name],
                        ...userAgentConfig
                    };
                } else {
                    // New agent type - must have all required fields
                    mergedAgentTypes[name] = userAgentConfig as AgentTypeConfig;
                }
            }
        }
    }

    return {
        version: userConfig.version ?? defaults.version,
        toolSets: mergedToolSets,
        agentTypes: mergedAgentTypes
    };
}

/**
 * Load and parse config.json from the given URI.
 * @param configUri - URI to the config file
 * @returns Parsed configuration or null if file doesn't exist
 * @throws ConfigValidationError if JSON is malformed
 */
async function loadConfigFile(configUri: vscode.Uri): Promise<Partial<MutsumiConfig> | null> {
    try {
        const content = await vscode.workspace.fs.readFile(configUri);
        const jsonString = new TextDecoder().decode(content);
        const parsed = JSON.parse(jsonString);
        
        if (typeof parsed !== 'object' || parsed === null) {
            throw new ConfigValidationError('Config file must contain a JSON object');
        }
        
        return parsed as Partial<MutsumiConfig>;
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            return null;
        }
        if (error instanceof SyntaxError) {
            throw new ConfigValidationError(`Invalid JSON in config file: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Load Mutsumi configuration.
 * 
 * 1. Loads built-in default configuration
 * 2. Attempts to load .mutsumi/config.json from workspace[0]
 * 3. Merges user config with defaults (user config takes precedence)
 * 4. Validates the merged configuration
 * 
 * @param registeredTools - Optional set of registered tool names for validation
 * @returns Validated MutsumiConfig
 * @throws ConfigValidationError if configuration is invalid
 */
export async function loadMutsumiConfig(
    registeredTools?: Set<string>
): Promise<MutsumiConfig> {
    // Start with built-in defaults
    let config: MutsumiConfig = { ...DEFAULT_MUTSUMI_CONFIG };

    // Try to load user config from workspace[0]
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (workspaceRoot) {
        const configUri = vscode.Uri.joinPath(workspaceRoot.uri, CONFIG_FILE_PATH);
        
        try {
            const userConfig = await loadConfigFile(configUri);
            
            if (userConfig) {
                // Merge user config with defaults
                config = mergeConfig(DEFAULT_MUTSUMI_CONFIG, userConfig);
            }
        } catch (error) {
            if (error instanceof ConfigValidationError) {
                // Re-throw validation errors
                throw error;
            }
            // Log other errors but continue with defaults
            console.warn('[Mutsumi] Failed to load config file:', error);
        }
    }

    // Validate the final configuration
    validateMutsumiConfig(config, registeredTools);

    return config;
}

/**
 * Check if a config file exists in the current workspace.
 * @returns True if config file exists
 */
export async function configFileExists(): Promise<boolean> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
        return false;
    }
    
    const configUri = vscode.Uri.joinPath(workspaceRoot.uri, CONFIG_FILE_PATH);
    
    try {
        await vscode.workspace.fs.stat(configUri);
        return true;
    } catch {
        return false;
    }
}
