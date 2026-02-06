import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
import { ToolManager } from '../toolManager';
import { ToolContext } from '../tools.d/interface';

export class ContextAssembler {

    /**
     * Assembles a document by recursively resolving static includes (&[path]) 
     * and then executing dynamic tool calls (&[tool]).
     * 
     * @param text The source text containing &[] tags.
     * @param workspaceRoot Root path for resolving relative paths.
     * @param allowedUris Allowed URIs for security check during tool execution.
     * @returns The fully assembled text.
     */
    static async assembleDocument(text: string, workspaceRoot: string, allowedUris: string[]): Promise<string> {
        if (!text.includes('&[')) return text;

        // 1. Resolve all static inclusions recursively (Flattening)
        let currentText = await this.resolveStaticIncludes(text, workspaceRoot, allowedUris, 0);
        
        // 2. Resolve all dynamic tools in the flattened text
        currentText = await this.resolveDynamicTools(currentText, allowedUris);
        
        return currentText;
    }

    private static async resolveStaticIncludes(text: string, root: string, allowedUris: string[], depth: number): Promise<string> {
        if (depth > 20) return text; // Prevent infinite recursion
        if (!text.includes('&[')) return text;

        let result = '';
        let lastIndex = 0;
        let hasChanges = false;
        
        let i = 0;
        while (i < text.length) {
            const start = text.indexOf('&[', i);
            if (start === -1) {
                result += text.substring(lastIndex);
                break;
            }
            
            const { content, endIdx } = this.extractBracketContent(text, start + 2);
            if (endIdx === -1) {
                // Malformed or no closing bracket, skip
                i = start + 2;
                continue;
            }

            // Append text before match
            result += text.substring(lastIndex, start);
            
            // Check if tool (has {) or file (no {)
            // We assume file paths don't contain {
            const braceStart = content.indexOf('{');
            
            if (braceStart !== -1) {
                // It has a {, likely a tool. Leave it for the dynamic pass.
                result += text.substring(start, endIdx + 1);
            } else {
                // Static Include
                try {
                    const { uri, startLine, endLine } = this.parseReference(content, root);
                    let fileContent = await this.readResource(uri, startLine, endLine);
                    
                    // Recursive resolve on the included content
                    fileContent = await this.resolveStaticIncludes(fileContent, root, allowedUris, depth + 1);
                    
                    result += fileContent;
                    hasChanges = true;
                } catch (e) {
                    result += `> Error including ${content}: ${(e as Error).message}`;
                }
            }
            
            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return hasChanges ? result : text;
    }

    private static async resolveDynamicTools(text: string, allowedUris: string[]): Promise<string> {
        if (!text.includes('&[')) return text;

        let result = '';
        let lastIndex = 0;
        let i = 0;

        while (i < text.length) {
            const start = text.indexOf('&[', i);
            if (start === -1) {
                result += text.substring(lastIndex);
                break;
            }

            const { content, endIdx } = this.extractBracketContent(text, start + 2);
            if (endIdx === -1) {
                i = start + 2;
                continue;
            }

            result += text.substring(lastIndex, start);

            const braceStart = content.indexOf('{');
            const braceEnd = content.lastIndexOf('}');

            if (braceStart !== -1 && braceEnd !== -1 && braceStart < braceEnd) {
                // Tool Call
                const toolName = content.substring(0, braceStart).trim();
                const jsonArgs = content.substring(braceStart, braceEnd + 1);
                
                try {
                    const args = JSON.parse(jsonArgs);
                    const output = await this.executeToolCall(toolName, args, allowedUris);
                    result += output;
                } catch (e: any) {
                    result += `> Error executing ${toolName}: ${e.message}`;
                }
            } else {
                // Not a tool (should have been handled by static include, or malformed)
                // Leave it as is
                result += text.substring(start, endIdx + 1);
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }
        
        return result;
    }

    // Helper: Execute Tool
    public static async executeToolCall(name: string, args: any, allowedUris: string[]): Promise<string> {
        const tm = ToolManager.getInstance();
        const context: ToolContext = {
            allowedUris: allowedUris,
        };
        // Tools in context are executed with "Main Agent" privileges usually? 
        // Or should we pass isSubAgent? 
        // For context loading, we assume it's safe/system level or same as current agent.
        // We'll pass `false` (Main) for now as default, or we can update signature to accept it.
        return await tm.executeTool(name, args, context, false); 
    }

    // Helper: Extract content inside [...] handling nested []
    public static extractBracketContent(text: string, start: number): { content: string, endIdx: number } {
        let depth = 0; 
        for (let i = start; i < text.length; i++) {
            if (text[i] === '[') depth++;
            else if (text[i] === ']') {
                if (depth === 0) {
                    return { content: text.substring(start, i), endIdx: i };
                }
                depth--;
            }
        }
        return { content: '', endIdx: -1 };
    }

    // Helper: Parse Reference String
    public static parseReference(ref: string, root: string) {
        const parts = ref.split(':');
        const filePath = parts[0];
        let startLine: number | undefined;
        let endLine: number | undefined;

        if (parts.length > 1) startLine = parseInt(parts[1], 10);
        if (parts.length > 2) endLine = parseInt(parts[2], 10);

        let uri: vscode.Uri;
        if (filePath.includes('://')) {
            uri = vscode.Uri.parse(filePath);
        } else {
            // Check if absolute
            if (path.isAbsolute(filePath)) {
                uri = vscode.Uri.file(filePath);
            } else {
                uri = vscode.Uri.file(path.join(root, filePath));
            }
        }

        return { uri, startLine, endLine };
    }

    // Helper: Read Resource
    public static async readResource(uri: vscode.Uri, start?: number, end?: number): Promise<string> {
        const stat = await vscode.workspace.fs.stat(uri);

        if (stat.type === vscode.FileType.Directory) {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => {
                const typeStr = type === vscode.FileType.Directory ? 'DIR' : 'FILE';
                return `[${typeStr}] ${name}`;
            }).join('\n');
        } else {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder().decode(bytes);

            if (start !== undefined) {
                const lines = content.split(/\r?\n/);
                const s = Math.max(0, start - 1);
                const e = end !== undefined ? end : s + 1; 
                return lines.slice(s, e).join('\n');
            }
            return content;
        }
    }
}
