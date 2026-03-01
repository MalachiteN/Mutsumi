import * as vscode from 'vscode';
import { AgentRegistry } from '../agent/registry';
import type { AgentStateInfo } from '../types';

/**
 * Retrieves an agent from the registry by UUID.
 * This is the single source of truth for agent lookups.
 */
export function getAgentFromRegistry(uuid: string): AgentStateInfo | undefined {
    const registry = AgentRegistry.getInstance();
    return registry.getAgent(uuid);
}

/**
 * Gets the first workspace folder URI.
 * This is the root used for Mutsumi configuration (rules, agents, etc.).
 */
export function getWorkspaceRoot(): vscode.Uri | undefined {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
        return undefined;
    }
    return wsFolders[0].uri;
}

/**
 * Gets all available rule filenames from the .mutsumi/rules directory.
 * This is a shared utility function used by multiple endpoints.
 * @returns Array of .md filenames in the rules directory
 */
export async function getAvailableRules(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) {
        return [];
    }

    const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');
    let allRules: string[] = [];

    try {
        const entries = await vscode.workspace.fs.readDirectory(rulesDir);
        allRules = entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
            .map(([name]) => name);
    } catch {
        // Rules directory doesn't exist or can't be read
    }

    return allRules;
}
