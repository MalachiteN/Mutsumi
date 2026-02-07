import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';
import { ToolManager } from '../toolManager';
import { ToolContext } from '../tools.d/interface';

/**
 * Parse Mode Enumeration
 * @description Defines two parsing modes for context assembly
 */
export enum ParseMode {
    /** Inline mode: replace the parsing result directly into the original text */
    INLINE = 'INLINE',
    /** Append mode: append the parsing result to the buffer while preserving the original text */
    APPEND = 'APPEND'
}

/**
 * Context Assembler Class
 * @description Responsible for parsing and assembling dynamic context, supports file reference @[path] and tool call @[tool] syntax
 * @example
 * // Use inline mode to assemble document
 * const result = await ContextAssembler.assembleDocument(text, workspaceRoot, allowedUris);
 */
export class ContextAssembler {

    /**
     * @description Assemble document, recursively parse static file references and dynamic tool calls
     * @param {string} text - Source text containing @[] tags
     * @param {string} workspaceRoot - Root path for resolving relative paths
     * @param {string[]} allowedUris - List of URIs allowed to access during tool execution (security check)
     * @param {ParseMode} [mode=ParseMode.INLINE] - Parsing mode (INLINE means replace in place, APPEND means append to buffer)
     * @param {string[]} [appendBuffer] - Result buffer for APPEND mode
     * @returns {Promise<string>} Fully assembled text (INLINE mode) or original text (APPEND mode)
     * @example
     * const text = '@[README.md]';
     * const result = await ContextAssembler.assembleDocument(text, '/workspace', ['/workspace'], ParseMode.INLINE);
     */
    static async assembleDocument(
        text: string,
        workspaceRoot: string,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        appendBuffer?: string[]
    ): Promise<string> {
        if (!text.includes('@[')) return text;

        // Step 1: Recursively resolve all static file references (flatten)
        const flattenedText = await this.resolveStaticIncludes(text, workspaceRoot, allowedUris, 0, mode, appendBuffer);

        // Step 2: Resolve all dynamic tool calls in the flattened text
        const resolvedText = await this.resolveDynamicTools(flattenedText, allowedUris, mode, appendBuffer);

        return mode === ParseMode.APPEND ? text : resolvedText;
    }

    /**
     * @description Parse references in user prompt, generate context reference blocks
     * @param {string} text - User input text, may contain @[path] references
     * @param {string} workspaceRoot - Workspace root path
     * @param {string[]} allowedUris - List of allowed URIs
     * @returns {Promise<string>} Formatted context reference string, returns empty string if no references
     * @example
     * const text = '@[src/utils.ts]';
     * const result = await ContextAssembler.resolveUserPromptReferences(text, '/workspace', ['/workspace']);
     * // Returns: ### User Provided Context References:\n\n#### Source: src/utils.ts\n\n```\n...\n```
     */
    static async resolveUserPromptReferences(
        text: string,
        workspaceRoot: string,
        allowedUris: string[]
    ): Promise<string> {
        const appendBuffer: string[] = [];
        await this.assembleDocument(text, workspaceRoot, allowedUris, ParseMode.APPEND, appendBuffer);

        if (appendBuffer.length === 0) return '';
        return ['### User Provided Context References:', '', ...appendBuffer].join('\n');
    }

    /**
     * @description Recursively parse static file references
     * @private
     * @param {string} text - Text to be parsed
     * @param {string} root - Workspace root path
     * @param {string[]} allowedUris - List of allowed URIs
     * @param {number} depth - Current recursion depth
     * @param {ParseMode} mode - Parsing mode
     * @param {string[]} [appendBuffer] - Append mode buffer
     * @returns {Promise<string>} Parsed text
     */
    private static async resolveStaticIncludes(
        text: string,
        root: string,
        allowedUris: string[],
        depth: number,
        mode: ParseMode,
        appendBuffer?: string[]
    ): Promise<string> {
        if (depth > 20) return text; // Prevent infinite recursion
        if (!text.includes('@[')) return text;

        let result = '';
        let lastIndex = 0;
        let hasChanges = false;

        let i = 0;
        while (i < text.length) {
            const start = text.indexOf('@[', i);
            if (start === -1) {
                result += text.substring(lastIndex);
                break;
            }

            const { content, endIdx } = this.extractBracketContent(text, start + 2);
            if (endIdx === -1) {
                // Malformed or missing closing bracket, skip
                i = start + 2;
                continue;
            }

            // Append text before the match
            result += text.substring(lastIndex, start);

            // Check if it's a tool (contains {) or file (does not contain {)
            const braceStart = content.indexOf('{');

            if (braceStart !== -1) {
                // Contains {, might be a tool call, preserve for dynamic parsing phase
                result += text.substring(start, endIdx + 1);
            } else {
                // Static file reference
                try {
                    const { uri, startLine, endLine } = this.parseReference(content, root);
                    const rawContent = await this.readResource(uri, startLine, endLine);

                    const shouldRecurse = this.shouldRecurseFile(uri);
                    let flattenedContent = rawContent;
                    if (shouldRecurse) {
                        flattenedContent = await this.resolveStaticIncludes(
                            rawContent,
                            root,
                            allowedUris,
                            depth + 1,
                            ParseMode.INLINE
                        );
                    }

                    const resolvedContent = mode === ParseMode.APPEND
                        ? await this.resolveDynamicTools(flattenedContent, allowedUris, ParseMode.INLINE)
                        : flattenedContent;

                    if (mode === ParseMode.INLINE) {
                        result += resolvedContent;
                    } else {
                        this.appendFileEntry(appendBuffer, content, resolvedContent);
                        result += text.substring(start, endIdx + 1);
                    }

                    hasChanges = true;
                } catch (e) {
                    const errorMessage = `> Error including ${content}: ${(e as Error).message}`;
                    if (mode === ParseMode.INLINE) {
                        result += errorMessage;
                    } else {
                        this.appendFileEntry(appendBuffer, content, errorMessage);
                        result += text.substring(start, endIdx + 1);
                    }
                }
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        if (mode === ParseMode.APPEND) {
            return text;
        }

        return hasChanges ? result : text;
    }

    /**
     * @description Parse dynamic tool calls
     * @private
     * @param {string} text - Text to be parsed
     * @param {string[]} allowedUris - List of allowed URIs
     * @param {ParseMode} mode - Parsing mode
     * @param {string[]} [appendBuffer] - Append mode buffer
     * @returns {Promise<string>} Parsed text
     */
    private static async resolveDynamicTools(
        text: string,
        allowedUris: string[],
        mode: ParseMode,
        appendBuffer?: string[]
    ): Promise<string> {
        if (!text.includes('@[')) return text;

        let result = '';
        let lastIndex = 0;
        let i = 0;

        while (i < text.length) {
            const start = text.indexOf('@[', i);
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
                // Tool call
                const toolName = content.substring(0, braceStart).trim();
                const jsonArgs = content.substring(braceStart, braceEnd + 1);

                try {
                    const args = JSON.parse(jsonArgs);
                    const output = await this.executeToolCall(toolName, args, allowedUris);

                    if (mode === ParseMode.INLINE) {
                        result += output;
                    } else {
                        this.appendToolEntry(appendBuffer, toolName, args, output);
                        result += text.substring(start, endIdx + 1);
                    }
                } catch (e: any) {
                    const errorMessage = `> Error executing ${toolName}: ${e.message}`;
                    if (mode === ParseMode.INLINE) {
                        result += errorMessage;
                    } else {
                        this.appendToolEntry(appendBuffer, toolName, jsonArgs, errorMessage);
                        result += text.substring(start, endIdx + 1);
                    }
                }
            } else {
                // Not a tool call (should be handled by static parsing, or malformed)
                // Keep as is
                result += text.substring(start, endIdx + 1);
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return mode === ParseMode.APPEND ? text : result;
    }

    /**
     * @description Determine if file needs recursive parsing
     * @private
     * @param {vscode.Uri} uri - File URI
     * @returns {boolean} Returns true if .md or .txt file
     */
    private static shouldRecurseFile(uri: vscode.Uri): boolean {
        const ext = path.extname(uri.fsPath).toLowerCase();
        return ext === '.md' || ext === '.txt';
    }

    /**
     * @description Append file entry to buffer
     * @private
     * @param {string[]} [buffer] - Target buffer
     * @param {string} source - Source path
     * @param {string} content - File content
     */
    private static appendFileEntry(buffer: string[] | undefined, source: string, content: string): void {
        if (!buffer) return;
        buffer.push(`#### Source: ${source}\n\n\`\`\`\n${content}\n\`\`\``);
    }

    /**
     * @description Append tool call entry to buffer
     * @private
     * @param {string[]} [buffer] - Target buffer
     * @param {string} toolName - Tool name
     * @param {any} args - Tool arguments
     * @param {string} output - Tool output
     */
    private static appendToolEntry(buffer: string[] | undefined, toolName: string, args: any, output: string): void {
        if (!buffer) return;
        const argsString = typeof args === 'string' ? args : JSON.stringify(args);
        buffer.push(`#### Tool Call: ${toolName}\n> Args: ${argsString}\n\n\`\`\`\n${output}\n\`\`\``);
    }

    /**
     * @description Execute tool call
     * @param {string} name - Tool name
     * @param {any} args - Tool arguments
     * @param {string[]} allowedUris - List of allowed URIs
     * @returns {Promise<string>} Tool execution result
     * @example
     * const output = await ContextAssembler.executeToolCall('read_file', { uri: 'src/main.ts' }, ['/workspace']);
     */
    public static async executeToolCall(name: string, args: any, allowedUris: string[]): Promise<string> {
        const tm = ToolManager.getInstance();
        const context: ToolContext = {
            allowedUris: allowedUris,
        };
        return await tm.executeTool(name, args, context, false);
    }

    /**
     * @description Extract content within brackets, supports nested brackets
     * @param {string} text - Source text
     * @param {number} start - Start position (after @[)
     * @returns {{ content: string, endIdx: number }} Object containing content and end index, endIdx is -1 if closing bracket not found
     * @example
     * const text = '@[some/path] rest';
     * const { content, endIdx } = ContextAssembler.extractBracketContent(text, 2);
     * // content = 'some/path', endIdx = 12
     */
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

    /**
     * @description Parse reference string, supports line number ranges
     * @param {string} ref - Reference string, format like "path/to/file.ts:10:20"
     * @param {string} root - Workspace root path
     * @returns {{ uri: vscode.Uri, startLine?: number, endLine?: number }} Parsed URI and line number range
     * @example
     * const { uri, startLine, endLine } = ContextAssembler.parseReference('src/main.ts:10:20', '/workspace');
     * // uri = file:///workspace/src/main.ts, startLine = 10, endLine = 20
     */
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
            // Check if it's an absolute path
            if (path.isAbsolute(filePath)) {
                uri = vscode.Uri.file(filePath);
            } else {
                uri = vscode.Uri.file(path.join(root, filePath));
            }
        }

        return { uri, startLine, endLine };
    }

    /**
     * @description Read resource content, supports files and directories
     * @param {vscode.Uri} uri - Resource URI
     * @param {number} [start] - Start line number (1-based, inclusive)
     * @param {number} [end] - End line number (inclusive)
     * @returns {Promise<string>} Resource content, returns directory list if it's a directory
     * @example
     * // Read entire file
     * const content = await ContextAssembler.readResource(vscode.Uri.file('/path/to/file.ts'));
     * // Read specified line range
     * const content = await ContextAssembler.readResource(uri, 10, 20);
     * // Read directory
     * const entries = await ContextAssembler.readResource(vscode.Uri.file('/path/to/dir'));
     */
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
