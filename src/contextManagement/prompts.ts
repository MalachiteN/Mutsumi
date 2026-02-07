import * as vscode from 'vscode';
import { TextDecoder } from 'util';

export async function initializeRules(extensionUri: vscode.Uri, workspaceUri: vscode.Uri) {
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');
    try {
        await vscode.workspace.fs.createDirectory(rulesDir);
        
        const assetsDir = vscode.Uri.joinPath(extensionUri, 'assets');
        
        // Copy default.md if not exists
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

    // Append Dynamic Context (Allowed URIs)
    const rawSystemPrompt = `${combinedRules.trim()}\n\n### Runtime Context\nCurrent Allowed URIs: ${JSON.stringify(allowedUris)}`;

    // Resolve &[] rules recursively using ContextAssembler
    const { ContextAssembler } = await import('./assembler');
    let finalPrompt = await ContextAssembler.assembleDocument(rawSystemPrompt, workspaceUri.fsPath, allowedUris);

    // Append Sub-Agent rules if applicable
    if (isSubAgent) {
        finalPrompt += `\n\n## Sub-Agent 身份标识\n你是一个 Sub-Agent（子代理）。结束任务时必须使用 \`task_finish\` 工具向 Parent Agent 报告完成状态。`;
    }

    return finalPrompt;
}
