import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';

const DEFAULT_SYSTEM_PROMPT = `You are Mutsumi, an AI software engineer. You are helpful, precise, and capable.
You have access to the local file system via tools. Always verify file paths.
When editing or reading, strictly adhere to the allowed paths.`;

const DEFAULT_SUBAGENT_PROMPT = `You are a Mutsumi Sub-Agent. You are designed to complete a specific, isolated task defined by your parent agent.
Focus strictly on the user's instructions. When the task is complete, YOU MUST CALL the 'task_finish' tool to report your results.
Do not ask the user for more input unless absolutely necessary; try to solve the problem with available context.`;

export async function getSystemPrompt(workspaceUri: vscode.Uri, allowedUris: string[], isSubAgent: boolean = false): Promise<string> {
    const rulesDir = vscode.Uri.joinPath(workspaceUri, '.mutsumi', 'rules');
    
    // 1. Ensure rules directory and default rules exist
    const targetDefaultName = isSubAgent ? 'default-subagent.md' : 'default.md';
    const excludedDefaultName = isSubAgent ? 'default.md' : 'default-subagent.md';

    try {
        await vscode.workspace.fs.createDirectory(rulesDir);
        
        // Ensure default.md exists
        const mainDefaultUri = vscode.Uri.joinPath(rulesDir, 'default.md');
        try { await vscode.workspace.fs.stat(mainDefaultUri); } catch {
            await vscode.workspace.fs.writeFile(mainDefaultUri, new TextEncoder().encode(DEFAULT_SYSTEM_PROMPT));
        }

        // Ensure default-subagent.md exists
        const subDefaultUri = vscode.Uri.joinPath(rulesDir, 'default-subagent.md');
        try { await vscode.workspace.fs.stat(subDefaultUri); } catch {
            await vscode.workspace.fs.writeFile(subDefaultUri, new TextEncoder().encode(DEFAULT_SUBAGENT_PROMPT));
        }

    } catch (e) {
        console.error('Failed to initialize rules directory', e);
        return `${isSubAgent ? DEFAULT_SUBAGENT_PROMPT : DEFAULT_SYSTEM_PROMPT}\nCurrent Allowed URIs: ${JSON.stringify(allowedUris)}`;
    }

    // 2. Read .md files (Dynamically filtering based on Agent Type)
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