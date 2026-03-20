import * as vscode from 'vscode';
import type { Request, Response } from 'express';
import { getModelsConfig } from '../utils';
import { getAgentFromRegistry } from './utils';
import type { AgentContext } from '../types';

/**
 * Handles PUT /agent/:uuid/model
 * Sets the model for a specific agent.
 */
export async function handleSetModel(req: Request, res: Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    const { model } = req.body ?? {};
    if (typeof model !== 'string' || !model.trim()) {
        res.status(400).json({ status: 'error', content: 'Missing or invalid model parameter.' });
        return;
    }

    // Validate model exists in configuration
    const models = getModelsConfig();
    const availableModels = Object.keys(models);

    if (!availableModels.includes(model)) {
        res.status(400).json({
            status: 'error',
            content: `Invalid model: ${model}. Available models: ${availableModels.join(', ')}`
        });
        return;
    }

    // Get agent from registry to get the actual file URI
    const agentInfo = getAgentFromRegistry(uuid);
    if (!agentInfo) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    const fileUri = vscode.Uri.parse(agentInfo.fileUri);

    try {
        // Read current content
        const content = await vscode.workspace.fs.readFile(fileUri);
        const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;

        // Update model in metadata
        data.metadata.model = model;

        // Write back
        const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        res.json({
            status: 'updated',
            agent: {
                uuid,
                model
            }
        });
    } catch (error: any) {
        console.error('Failed to set model:', error);
        res.status(500).json({ status: 'error', content: `Failed to set model: ${error.message}` });
    }
}
