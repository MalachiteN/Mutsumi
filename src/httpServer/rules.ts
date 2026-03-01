import * as vscode from 'vscode';
import type { Request, Response } from 'express';
import { getWorkspaceRoot, getAvailableRules, getAgentFromRegistry } from './utils';
import type { AgentContext } from '../types';

/**
 * GET /rules - Get all available rule filenames
 */
export async function handleListRules(req: Request, res: Response): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
        res.status(400).json({ status: 'error', content: 'No workspace folder open.' });
        return;
    }

    try {
        const rules = await getAvailableRules();
        res.json({
            status: 'ok',
            rules,
            count: rules.length
        });
    } catch (error: any) {
        console.error('Failed to list rules:', error);
        res.status(500).json({ status: 'error', content: `Failed to list rules: ${error.message}` });
    }
}

/**
 * GET /rules/:name - Download a specific rule file
 */
export async function handleGetRuleFile(req: Request, res: Response): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
        res.status(400).json({ status: 'error', content: 'No workspace folder open.' });
        return;
    }

    const nameParam = req.params.name;
    const name = Array.isArray(nameParam) ? nameParam[0] : nameParam;

    if (!name) {
        res.status(400).json({ status: 'error', content: 'Missing rule filename.' });
        return;
    }

    // Validate filename: must end with .md and not contain path traversal
    if (!name.endsWith('.md') || name.includes('..') || name.includes('/') || name.includes('\\')) {
        res.status(400).json({ status: 'error', content: 'Invalid rule filename.' });
        return;
    }

    // Verify the file exists in available rules
    const availableRules = await getAvailableRules();
    if (!availableRules.includes(name)) {
        res.status(404).json({ status: 'error', content: `Rule file '${name}' not found.` });
        return;
    }

    const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');
    const fileUri = vscode.Uri.joinPath(rulesDir, name);

    try {
        const content = await vscode.workspace.fs.readFile(fileUri);
        const contentText = new TextDecoder().decode(content);

        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.send(contentText);
    } catch (error: any) {
        console.error('Failed to read rule file:', error);
        res.status(500).json({ status: 'error', content: `Failed to read rule file: ${error.message}` });
    }
}

/**
 * PUT /agent/:uuid/rules - Set agent's active rules
 */
export async function handleSetRules(req: Request, res: Response): Promise<void> {
    const uuidParam = req.params.uuid;
    const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
    if (!uuid) {
        res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
        return;
    }

    const { rules } = req.body ?? {};
    if (!Array.isArray(rules)) {
        res.status(400).json({ status: 'error', content: 'Missing or invalid rules parameter. Must be an array of strings.' });
        return;
    }

    // Validate all items are strings
    if (!rules.every(r => typeof r === 'string')) {
        res.status(400).json({ status: 'error', content: 'All rules must be strings.' });
        return;
    }

    // Get agent from registry
    const agentInfo = getAgentFromRegistry(uuid);
    if (!agentInfo) {
        res.status(404).json({ status: 'error', content: 'Agent not found.' });
        return;
    }

    // Validate all rules exist
    const availableRules = await getAvailableRules();
    const invalidRules = rules.filter(rule => !availableRules.includes(rule));
    if (invalidRules.length > 0) {
        res.status(400).json({
            status: 'error',
            content: `Invalid rules: ${invalidRules.join(', ')}. Available rules: ${availableRules.join(', ')}`
        });
        return;
    }

    const fileUri = vscode.Uri.parse(agentInfo.fileUri);

    try {
        // Read current content
        const content = await vscode.workspace.fs.readFile(fileUri);
        const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;

        // Update activeRules in metadata
        data.metadata.activeRules = rules;

        // Write back
        const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        res.json({
            status: 'updated',
            agent: {
                uuid,
                activeRules: rules
            }
        });
    } catch (error: any) {
        console.error('Failed to set rules:', error);
        res.status(500).json({ status: 'error', content: `Failed to set rules: ${error.message}` });
    }
}
