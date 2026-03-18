import * as vscode from 'vscode';
import * as express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import { AgentRegistry } from '../agent/registry';
import { initializeRules } from '../contextManagement/prompts';
import { getAvailableRules } from './utils';
import { MutsumiSerializer } from '../notebook/serializer';
import type { AgentContext, AgentMetadata } from '../types';

export interface CreateAgentDependencies {
    extensionUri: vscode.Uri;
}

export interface ListAgentsDependencies {
    // No external dependencies needed for listing agents
}

/**
 * Creates a handler for POST /agents - Create a new agent
 */
export function createCreateAgentHandler(
    deps: CreateAgentDependencies
): express.RequestHandler {
    return async (req: express.Request, res: express.Response): Promise<void> => {
        try {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                res.status(400).json({ status: 'error', content: 'No workspace folder open.' });
                return;
            }

            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');

            // Create .mutsumi directory if it doesn't exist
            try {
                await vscode.workspace.fs.createDirectory(agentDir);
            } catch {
                // Directory may already exist
            }

            // Initialize rules
            await initializeRules(deps.extensionUri, root);

            // Get all existing rules to initialize the agent with all rules enabled
            const allRules = await getAvailableRules();

            // Generate UUID for the new agent
            const uuid = uuidv4();
            const name = `agent-${Date.now()}.mtm`;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);

            // Collect all workspace root URIs
            const allWorkspaceUris = vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) || [root.toString()];

            // Create initial content using MutsumiSerializer (reuses logic from extension.ts)
            const initialContent = MutsumiSerializer.createDefaultContent(allWorkspaceUris, allRules, uuid);

            // Write the file
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);

            // Register the agent in the registry
            // Parse metadata from the generated content to ensure consistency
            const agentContext = JSON.parse(new TextDecoder().decode(initialContent)) as AgentContext;
            await AgentOrchestrator.getInstance().notifyNotebookDocumentOpened(uuid, newFileUri, agentContext.metadata);

            res.status(201).json({
                status: 'created',
                uuid: uuid,
                name: agentContext.metadata.name,
                fileUri: newFileUri.toString(),
                content: 'New agent created successfully.'
            });
        } catch (error: any) {
            console.error('Failed to create agent:', error);
            res.status(500).json({ status: 'error', content: `Failed to create agent: ${error.message}` });
        }
    };
}

/**
 * Creates a handler for GET /agents - List all agents
 */
export function createListAgentsHandler(
    _deps: ListAgentsDependencies
): express.RequestHandler {
    return async (_req: express.Request, res: express.Response): Promise<void> => {
        const registry = AgentRegistry.getInstance();
        const agents = registry.getAllAgents();

        res.json({
            status: 'ok',
            agents: agents.map(agent => ({
                uuid: agent.uuid,
                name: agent.name
            }))
        });
    };
}
