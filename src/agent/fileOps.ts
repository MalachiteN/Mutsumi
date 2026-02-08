/**
 * @fileoverview File operations for Agent management.
 * @module agent/fileOps
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AgentStateInfo } from '../types';

/**
 * Handles file-based operations for agents.
 * @description Provides static methods for loading, creating, and updating agent files.
 * All methods are pure functions or class methods that don't involve global state.
 * @class AgentFileOperations
 */
export class AgentFileOperations {
    /**
     * Gets the agent file URI based on workspace root and UUID.
     * @static
     * @param {string} uuid - Agent UUID
     * @returns {vscode.Uri | undefined} The file URI or undefined if no workspace
     * @example
     * const uri = AgentFileOperations.getAgentFileUri('abc-123');
     * // Returns: file:///workspace/.mutsumi/abc-123.mtm
     */
    public static getAgentFileUri(uuid: string): vscode.Uri | undefined {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
        if (!workspaceRoot) return undefined;

        return workspaceRoot.with({
            path: path.posix.join(workspaceRoot.path, '.mutsumi', `${uuid}.mtm`),
        });
    }

    /**
     * Loads an agent from file if it exists.
     * @static
     * @param {string} uuid - Agent UUID to load
     * @returns {Promise<AgentStateInfo | undefined>} The loaded agent info or undefined
     * @example
     * const agent = await AgentFileOperations.loadAgentFromFile('abc-123');
     */
    public static async loadAgentFromFile(uuid: string): Promise<AgentStateInfo | undefined> {
        const fileUri = this.getAgentFileUri(uuid);
        if (!fileUri) return undefined;

        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content));
            
            const agent: AgentStateInfo = {
                uuid,
                parentId: data.metadata?.parent_agent_id || null,
                name: data.metadata?.name || 'Unknown Agent',
                fileUri: fileUri.toString(),
                isWindowOpen: false,
                isRunning: false,
                isTaskFinished: !!data.metadata?.is_task_finished,
                childIds: new Set(data.metadata?.sub_agents_list || [])
            };
            
            return agent;
        } catch {
            return undefined;
        }
    }

    /**
     * Creates a new agent file.
     * @static
     * @param {string} uuid - UUID for the new agent
     * @param {string | null} parentId - Parent agent ID or null
     * @param {string} prompt - Initial prompt for the agent (used for name generation)
     * @param {string[]} allowedUris - Allowed URIs for the agent
     * @param {string} [model] - Model identifier to use
     * @param {string[]} [parentSubAgents] - Current parent's sub_agents_list (for reference)
     * @returns {Promise<vscode.Uri | undefined>} The created file URI or undefined on failure
     * @example
     * const uri = await AgentFileOperations.createAgentFile(
     *   'abc-123',
     *   'parent-456',
     *   'Process files',
     *   ['/workspace'],
     *   'gpt-4'
     * );
     */
    public static async createAgentFile(
        uuid: string,
        parentId: string | null,
        prompt: string,
        allowedUris: string[],
        model?: string,
        parentSubAgents?: string[]
    ): Promise<vscode.Uri | undefined> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
        if (!workspaceRoot) {
            return undefined;
        }

        const folderUri = workspaceRoot.with({
            path: path.posix.join(workspaceRoot.path, '.mutsumi'),
        });
        const fileUri = folderUri.with({
            path: path.posix.join(folderUri.path, `${uuid}.mtm`),
        });

        // Ensure directory exists
        try { 
            await vscode.workspace.fs.createDirectory(folderUri); 
        } catch {
            // Directory may already exist
        }

        // Get configuration for default model
        const config = vscode.workspace.getConfiguration('mutsumi');
        const defaultModel = config.get<string>('defaultModel') || 'gpt-3.5-turbo';
        const availableModels = config.get<Record<string, string>>('models', {});
        const availableModelNames = Object.keys(availableModels);

        const selectedModel = (model && availableModelNames.includes(model)) ? model : defaultModel;

        const content: any = {
            metadata: {
                uuid: uuid,
                name: prompt.slice(0, 20) + '...',
                created_at: new Date().toISOString(),
                parent_agent_id: parentId,
                allowed_uris: allowedUris,
                is_task_finished: false,
                model: selectedModel,
                sub_agents_list: []  // New agent starts with empty sub-agent list
            },
            context: [
                { role: 'user', content: prompt }
            ]
        };
        
        const encoded = new TextEncoder().encode(JSON.stringify(content, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        return fileUri;
    }

    /**
     * Updates the parent reference of an agent in its file.
     * @static
     * @description Uses WorkspaceEdit to update notebook metadata if the document is open,
     * otherwise writes directly to file. This avoids conflicts with VS Code's editor buffer.
     * @param {AgentStateInfo} agent - The agent to update
     * @param {string | null} newParentId - New parent ID or null
     * @returns {Promise<boolean>} True if update was successful
     * @example
     * await AgentFileOperations.updateAgentParentInFile(agent, 'new-parent-456');
     */
    public static async updateAgentParentInFile(
        agent: AgentStateInfo,
        newParentId: string | null
    ): Promise<boolean> {
        try {
            const fileUri = vscode.Uri.parse(agent.fileUri);
            
            // Check if the notebook document is currently open
            const openDoc = vscode.workspace.notebookDocuments.find(
                doc => doc.uri.toString() === fileUri.toString()
            );
            
            if (openDoc) {
                // Use WorkspaceEdit to update metadata through VS Code's API
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { 
                    ...openDoc.metadata, 
                    parent_agent_id: newParentId 
                };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(fileUri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
            } else {
                // Document not open, write directly to file
                const content = await vscode.workspace.fs.readFile(fileUri);
                const data = JSON.parse(new TextDecoder().decode(content));
                
                data.metadata.parent_agent_id = newParentId;
                
                const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
                await vscode.workspace.fs.writeFile(fileUri, encoded);
            }
            return true;
        } catch (e) {
            console.error('Failed to update agent parent in file:', e);
            return false;
        }
    }

    /**
     * Updates the sub_agents_list of a parent agent in its file.
     * @static
     * @description Uses WorkspaceEdit to update notebook metadata if the document is open,
     * otherwise writes directly to file. This avoids conflicts with VS Code's editor buffer.
     * @param {AgentStateInfo} parent - The parent agent to update
     * @returns {Promise<boolean>} True if update was successful
     * @example
     * await AgentFileOperations.updateParentSubAgentsList(parent);
     */
    public static async updateParentSubAgentsList(parent: AgentStateInfo): Promise<boolean> {
        try {
            const fileUri = vscode.Uri.parse(parent.fileUri);
            
            // Check if the notebook document is currently open
            const openDoc = vscode.workspace.notebookDocuments.find(
                doc => doc.uri.toString() === fileUri.toString()
            );
            
            if (openDoc) {
                // Use WorkspaceEdit to update metadata through VS Code's API
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { 
                    ...openDoc.metadata, 
                    sub_agents_list: Array.from(parent.childIds || []) 
                };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(fileUri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
            } else {
                // Document not open, write directly to file
                const content = await vscode.workspace.fs.readFile(fileUri);
                const data = JSON.parse(new TextDecoder().decode(content));
                
                data.metadata.sub_agents_list = Array.from(parent.childIds || []);
                
                const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
                await vscode.workspace.fs.writeFile(fileUri, encoded);
            }
            return true;
        } catch (e) {
            console.error('Failed to update parent sub_agents_list:', e);
            return false;
        }
    }
}
