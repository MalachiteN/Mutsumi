import * as vscode from 'vscode';
import type { Request, Response } from 'express';
import { HeadlessAdapter } from '../adapters/headlessAdapter';
import type { IAgentAdapter } from '../adapters/interfaces';
import { NotebookAdapter } from '../adapters/notebookAdapter';
import {
    normalizeReasoningEffort,
    REASONING_EFFORT_SETTING_VALUES
} from '../agent/types';
import { getAgentFromRegistry } from './utils';

/** Selects the metadata adapter appropriate for the resource's current state. */
function resolveReasoningEffortAdapter(fileUri: vscode.Uri): IAgentAdapter {
    const isOpen = vscode.workspace.notebookDocuments.some(
        document => document.uri.toString() === fileUri.toString()
    );
    return isOpen ? new NotebookAdapter() : new HeadlessAdapter();
}

/** Resolves an override to the HTTP representation. */
function resolveEffective(override: string | undefined): string {
    return normalizeReasoningEffort(override) ?? 'default';
}

/** Handles GET /agent/:uuid/reasoning-effort. */
export async function handleGetReasoningEffort(req: Request, res: Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    const agentInfo = getAgentFromRegistry(uuid);
    if (!agentInfo) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    const fileUri = vscode.Uri.parse(agentInfo.fileUri);
    const adapter = resolveReasoningEffortAdapter(fileUri);

    try {
        const override = await adapter.getReasoningEffort!(fileUri);
        res.json({
            status: 'ok',
            agent: {
                uuid,
                override: override ?? null,
                effective: resolveEffective(override)
            }
        });
    } catch (error: any) {
        console.error('Failed to get reasoning effort:', error);
        res.status(500).json({
            status: 'error',
            content: `Failed to get reasoning effort: ${error.message}`
        });
    }
}

/** Handles PUT /agent/:uuid/reasoning-effort. */
export async function handleSetReasoningEffort(req: Request, res: Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    const reasoningEffort = req.body?.reasoning_effort;
    if (typeof reasoningEffort !== 'string'
        || !REASONING_EFFORT_SETTING_VALUES.includes(reasoningEffort as any)) {
        res.status(400).json({
            status: 'error',
            content: `Invalid reasoning_effort. Valid values: ${REASONING_EFFORT_SETTING_VALUES.join(', ')}`
        });
        return;
    }

    const agentInfo = getAgentFromRegistry(uuid);
    if (!agentInfo) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    const fileUri = vscode.Uri.parse(agentInfo.fileUri);
    const adapter = resolveReasoningEffortAdapter(fileUri);
    const override = reasoningEffort === 'default' ? undefined : reasoningEffort;

    try {
        await adapter.setReasoningEffort!(fileUri, override);
        res.json({
            status: 'updated',
            agent: {
                uuid,
                override: override ?? null,
                effective: resolveEffective(override)
            }
        });
    } catch (error: any) {
        console.error('Failed to set reasoning effort:', error);
        res.status(500).json({
            status: 'error',
            content: `Failed to set reasoning effort: ${error.message}`
        });
    }
}
