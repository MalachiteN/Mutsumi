import * as vscode from 'vscode';
import type { Request, Response } from 'express';
import { resolveModelSelection } from '../utils';
import { AgentFileOperations } from '../agent/fileOps';
import { getAgentFromRegistry } from './utils';
import type { HeadlessAdapter } from '../adapters/headlessAdapter';

/**
 * Creates a handler for PUT /agent/:uuid/model
 * Sets the model/provider pair for a specific agent.
 */
export function createHandleSetModel(adapter: HeadlessAdapter): (req: Request, res: Response) => Promise<void> {
    return async function handleSetModel(req: Request, res: Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        const { model, provider } = req.body ?? {};
        if (typeof model !== 'string' || !model.trim() || typeof provider !== 'string' || !provider.trim()) {
            res.status(400).json({ status: 'error', content: 'Missing or invalid model/provider parameters. Both are required.' });
            return;
        }

        // Validate the complete pair through the resolution gate.
        let resolvedSelection: { model: string; provider: string };
        try {
            resolvedSelection = resolveModelSelection({ model, provider });
        } catch (err: any) {
            res.status(400).json({ status: 'error', content: err.message });
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
            // Persist through the single write point.
            await AgentFileOperations.updateAgentModelSelection(fileUri, resolvedSelection);

            // Synchronize the cached headless session so a later save does not roll back.
            const session = adapter.getSession(uuid);
            if (session) {
                session.setConfig({
                    metadata: {
                        model: resolvedSelection.model,
                        provider: resolvedSelection.provider
                    } as any
                });
            }

            res.json({
                status: 'updated',
                agent: {
                    uuid,
                    model: resolvedSelection.model,
                    provider: resolvedSelection.provider
                }
            });
        } catch (error: any) {
            console.error('Failed to set model:', error);
            res.status(500).json({ status: 'error', content: `Failed to set model: ${error.message}` });
        }
    };
}
