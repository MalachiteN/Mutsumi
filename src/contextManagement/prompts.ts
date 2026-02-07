import * as vscode from 'vscode';
import { TextDecoder } from 'util';

/**
 * @description Initialize rules directory and default rules file
 * @param {vscode.Uri} extensionUri - Extension's root URI
 * @param {vscode.Uri} workspaceUri - Workspace URI
 * @returns {Promise<void>}
 * @description Create default rules file in workspace .mutsumi/rules directory
 * @description If default.md doesn't exist, copy from extension's assets directory
 * @example
 * const extUri = context.extensionUri;
 * const wsUri = vscode.workspace.workspaceFolders[0].uri;
 * await initializeRules(extUri, wsUri);
 * // Result: create .mutsumi/rules/default.md (if not exists)
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
 * @description Get system prompt
 * @param {vscode.Uri} workspaceUri - Workspace URI
 * @param {string[]} allowedUris - List of allowed URIs
 * @param {boolean} [isSubAgent] - Whether it's a sub-agent
 * @returns {Promise<string>} Assembled system prompt
 * @description Read all .md files in .mutsumi/rules directory and merge
 * @description Use ContextAssembler to recursively parse @[path] references
 * @description If it's a sub-agent, append sub-agent identity description
 * @example
 * const prompt = await getSystemPrompt(wsUri, ['/workspace'], false);
 * // Returns system prompt containing rules file content and runtime context
 */
export async function getSystemPrompt(workspaceUri: vscode.Uri, allowedUris: string[], isSubAgent?: boolean): Promise<string> {
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');

    // Read all .md files in rules directory
    let combinedRules = '';
    try {
        const files = await vscode.workspace.fs.readDirectory(rulesDir);
        for (const [name, type] of files) {
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                const fileUri = vscode.Uri.joinPath(rulesDir, name);
                const content = await vscode.workspace.fs.readFile(fileUri);
                combinedRules += `\n\n### Rule (${name})\n${new TextDecoder().decode(content)}`;
            }
        }
    } catch (e) {
        console.error('Error reading rules', e);
    }

    // Append runtime context (allowed URIs list)
    const rawSystemPrompt = `${combinedRules.trim()}\n\n### Runtime Context\nCurrent Allowed URIs: ${JSON.stringify(allowedUris)}`;

    // Use ContextAssembler to recursively parse @[path] references
    const { ContextAssembler, ParseMode } = await import('./contextAssembler');
    let finalPrompt = await ContextAssembler.assembleDocument(rawSystemPrompt, workspaceUri.fsPath, allowedUris, ParseMode.INLINE);

    // If it's a sub-agent, append sub-agent identity
    if (isSubAgent) {
        finalPrompt += `\n\n## Sub-Agent Identity\nYou are a Sub-Agent. When finishing a task, you must use the \`task_finish\` tool to report completion status to the Parent Agent.`;
    }

    return finalPrompt;
}
