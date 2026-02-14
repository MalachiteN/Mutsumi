import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { ContextItem } from '../types';
import { ContextAssembler, ParseMode } from './contextAssembler';
import { MacroContext } from './preprocessor';
import { withRuleParsingMode } from '../tools.d/permission';

/**
 * @description Initialize rules directory and default rules file
 */
export async function initializeRules(extensionUri: vscode.Uri, workspaceUri: vscode.Uri) {
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');
    try {
        await vscode.workspace.fs.createDirectory(rulesDir);

        const assetsDir = vscode.Uri.joinPath(extensionUri, 'assets');

        // Copy if default.md doesn't exist
        const mainDefaultUri = vscode.Uri.joinPath(rulesDir, 'default.md');
        try {
            await vscode.workspace.fs.stat(mainDefaultUri);
        } catch {
            const assetDefaultUri = vscode.Uri.joinPath(assetsDir, 'default.md');
            await vscode.workspace.fs.copy(assetDefaultUri, mainDefaultUri, { overwrite: false });
        }
    } catch (e) {
        console.error('Failed to initialize rules from assets', e);
    }
}

/**
 * @description Get static system prompt (identity, sub-agent info)
 */
export async function getSystemPrompt(workspaceUri: vscode.Uri, allowedUris: string[], isSubAgent?: boolean): Promise<string> {
    // Only return static identity and runtime context
    let prompt = `### Runtime Context
Current Allowed URIs: ${JSON.stringify(allowedUris)}`;

    if (isSubAgent) {
        prompt += `\n\n## Sub-Agent Identity\nYou are a Sub-Agent. When finishing a task, you must use the \`task_finish\` tool to report completion status to the Parent Agent.`;
    }

    return prompt;
}

/**
 * @description Get rules content as structured context items
 * @param workspaceUri - Workspace root URI (must be file:// scheme)
 * @param allowedUris - List of allowed URIs for security
 * @param macroContext - Optional shared MacroContext for processing rules with user-defined macros
 * @param activeRules - Optional list of rule filenames to include. If undefined, all rules are included.
 * @returns Array of context items representing rules
 */
export async function getRulesContext(
    workspaceUri: vscode.Uri, 
    allowedUris: string[],
    macroContext?: MacroContext,
    activeRules?: string[]
): Promise<ContextItem[]> {
    // Rules are stored in local file system, ensure we have a valid path
    if (workspaceUri.scheme !== 'file') {
        console.warn('Rules context requires a file:// workspace URI');
        return [];
    }
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');
    const items: ContextItem[] = [];

    try {
        const files = await vscode.workspace.fs.readDirectory(rulesDir);
        // Sort files to ensure deterministic order
        files.sort((a, b) => a[0].localeCompare(b[0]));

        for (const [name, type] of files) {
            if (activeRules && !activeRules.includes(name)) {
                continue;
            }
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                const fileUri = vscode.Uri.joinPath(rulesDir, name);
                const content = await vscode.workspace.fs.readFile(fileUri);
                const decodedContent = new TextDecoder().decode(content);

                // We process the rule content to resolve any nested @[...] references (INLINE)
                // Rules should be fully expanded when presented
                // Use withRuleParsingMode to auto-approve tool calls during rule parsing
                const expandedContent = await withRuleParsingMode(() =>
                    ContextAssembler.assembleDocument(
                        decodedContent,
                        workspaceUri,
                        allowedUris,
                        ParseMode.INLINE,
                        undefined,  // collector (not used here)
                        macroContext  // Pass macro context for preprocessing
                    )
                );

                items.push({
                    type: 'rule', // Treating rules as a special type of context
                    key: name,
                    content: expandedContent
                } as any); // cast to any to allow 'rule' type if strict check fails, or update ContextItem type definition if needed
            }
        }
    } catch (e) {
        console.error('Error reading rules', e);
    }

    return items;
}
