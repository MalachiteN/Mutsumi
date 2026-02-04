import * as vscode from 'vscode';
import * as path from 'path';

export interface ResolvedContext {
    originalRef: string;
    content: string;
    type: 'file' | 'directory' | 'error';
}

export class ContextResolver {
    // 匹配 @[path:start:end] 或 @[path:start] 或 @[path]
    // 路径允许包含 / . _ - 字母数字
    private static REF_REGEX = /@\[([a-zA-Z0-9_\-\/\.\\\:]+)\]/g;

    static async resolveReferencesInText(text: string, workspaceRoot: string): Promise<string> {
        const matches = [...text.matchAll(ContextResolver.REF_REGEX)];
        if (matches.length === 0) return '';

        let injectedContext = "### User Provided Context References:\n\n";

        for (const match of matches) {
            const fullTag = match[0];
            const innerContent = match[1]; // e.g., "src/main.ts:10:20"
            
            try {
                const { uri, startLine, endLine } = this.parseReference(innerContent, workspaceRoot);
                const result = await this.readResource(uri, startLine, endLine);
                
                injectedContext += `#### Source: ${innerContent}\n\`\`\`\n${result}\n\`\`\`\n\n`;
            } catch (e: any) {
                injectedContext += `#### Source: ${innerContent}\n> Error reading reference: ${e.message}\n\n`;
            }
        }
        
        return injectedContext;
    }

    private static parseReference(ref: string, root: string) {
        const parts = ref.split(':');
        const filePath = parts[0];
        let startLine: number | undefined;
        let endLine: number | undefined;

        if (parts.length > 1) startLine = parseInt(parts[1], 10);
        if (parts.length > 2) endLine = parseInt(parts[2], 10);

        // Handle schema if present, otherwise join with root
        let uri: vscode.Uri;
        if (filePath.includes('://')) {
            uri = vscode.Uri.parse(filePath);
        } else {
            // Handle Windows/Unix path separators if necessary, but workspace.fs handles Uri.file well
            uri = vscode.Uri.file(path.join(root, filePath));
        }

        return { uri, startLine, endLine };
    }

    private static async readResource(uri: vscode.Uri, start?: number, end?: number): Promise<string> {
        const stat = await vscode.workspace.fs.stat(uri);

        if (stat.type === vscode.FileType.Directory) {
            // Read Directory (LS)
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => {
                const typeStr = type === vscode.FileType.Directory ? 'DIR' : 'FILE';
                return `[${typeStr}] ${name}`;
            }).join('\n');
        } else {
            // Read File
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder().decode(bytes);

            if (start !== undefined) {
                const lines = content.split(/\r?\n/);
                // Convert 1-based index to 0-based
                const s = Math.max(0, start - 1);
                // If end is provided, it is inclusive in 1-based logic (e.g. 10:12 means lines 10, 11, 12).
                // slice end is exclusive. So end 12 -> index 12 (which is start of line 13).
                const e = end !== undefined ? end : s + 1; 
                
                return lines.slice(s, e).join('\n');
            }
            
            return content;
        }
    }
}