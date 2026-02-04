import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';

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

        // Copy default-subagent.md if not exists
        const subDefaultUri = vscode.Uri.joinPath(rulesDir, 'default-subagent.md');
        try { 
            await vscode.workspace.fs.stat(subDefaultUri); 
        } catch {
            const assetSubDefaultUri = vscode.Uri.joinPath(assetsDir, 'default-subagent.md');
            await vscode.workspace.fs.copy(assetSubDefaultUri, subDefaultUri, { overwrite: false });
        }
    } catch (e) {
        console.error('Failed to initialize rules from assets', e);
    }
}

export async function getSystemPrompt(workspaceUri: vscode.Uri, allowedUris: string[], isSubAgent: boolean = false): Promise<string> {
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');
    const excludedDefaultName = isSubAgent ? 'default.md' : 'default-subagent.md';

    // Read .md files (Dynamically filtering based on Agent Type)
    let combinedRules = '';
    try {
        const files = await vscode.workspace.fs.readDirectory(rulesDir);
        for (const [name, type] of files) {
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                // Logic: 
                // If isSubAgent: Use default-subagent.md, Ignore default.md
                // If !isSubAgent: Use default.md, Ignore default-subagent.md
                // Always include other custom .md files

                if (name === excludedDefaultName) continue;

                const fileUri = vscode.Uri.joinPath(rulesDir, name);
                const content = await vscode.workspace.fs.readFile(fileUri);
                
                // If it's the target default, put it at the top implies standard behavior, 
                // but here we just append. The User provided code appended them all.
                // We can mark the Base System Prompt distinctively if needed, but appending is fine.
                combinedRules += `\n\n### Rule (${name})\n${new TextDecoder().decode(content)}`;
            }
        }
    } catch (e) {
        console.error('Error reading rules', e);
    }

    // 3. Append Dynamic Context (Allowed URIs)
    return `${combinedRules.trim()}\n\n### Runtime Context\nCurrent Allowed URIs: ${JSON.stringify(allowedUris)}`;
}