import * as vscode from 'vscode';
import * as express from 'express';
import { getAgentFromRegistry } from './utils';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import type { AgentMessage, AgentContext } from '../types';

/**
 * Handle GET /agent/:uuid - Get agent details with full history
 */
export async function handleGetAgent(req: express.Request, res: express.Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    // Get agent from registry
    const agent = getAgentFromRegistry(uuid);
    if (!agent) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    // Load full history from file
    const fileUri = vscode.Uri.parse(agent.fileUri);
    let history: AgentMessage[] = [];
    if (fileUri) {
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;
            if (Array.isArray(data.context)) {
                history = data.context;
            }
        } catch {
            // Ignore, return empty history
        }
    }

    res.json({
        status: 'ok',
        agent: {
            ...agent,
            childIds: Array.from(agent.childIds ?? [])
        },
        history
    });
}

/**
 * Handle DELETE /agent/:uuid - Delete an agent
 */
export async function handleDeleteAgent(req: express.Request, res: express.Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    // Get agent from registry
    const agent = getAgentFromRegistry(uuid);
    if (!agent) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    try {
        // Delete the file
        const fileUri = vscode.Uri.parse(agent.fileUri);
        await vscode.workspace.fs.delete(fileUri);

        // Notify orchestrator to clean up registry
        await AgentOrchestrator.getInstance().notifyFileDeleted(fileUri);

        res.json({
            status: 'deleted',
            agent: {
                uuid,
                name: agent.name
            }
        });
    } catch (error: any) {
        console.error('Failed to delete agent:', error);
        res.status(500).json({ status: 'error', content: `Failed to delete agent: ${error.message}` });
    }
}
