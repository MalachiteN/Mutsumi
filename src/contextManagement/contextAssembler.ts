import * as vscode from 'vscode';
const matter = require('gray-matter');
import { Preprocessor, MacroScope } from './preprocessor';
import {
    extractBracketContent,
    parseReference,
    readResource,
    isMarkdownFile,
    executeToolCall
} from './utils';

/**
 * Parse Mode Enumeration
 * @description Defines two parsing modes for context assembly
 */
export enum ParseMode {
    /** Inline mode: replace the parsing result directly into the original text */
    INLINE = 'INLINE',
    /** Append mode: append the parsing result to the collector while preserving the original text */
    APPEND = 'APPEND'
}

import { ContextItem } from '../types';
export { ContextItem };

/**
 * Context Assembler Class
 * @description Responsible for parsing and assembling dynamic context, supports file reference @[path] and tool call @[tool] syntax
 */
export class ContextAssembler {

    /**
     * @description Assemble document with full pipeline
     * @param text - Document text to process
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param mode - Parse mode (INLINE or APPEND)
     * @param collector - Optional context item collector
     * @param scope - Optional macro scope for passing macro definitions
     */
    static async assembleDocument(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[],
        scope?: MacroScope
    ): Promise<string> {
        // Step 1: Resolve static includes (@[path] without {args})
        // This now calls Preprocessor which handles recursive processing
        let result = await this.resolveStaticIncludes(text, workspaceRoot, allowedUris, mode, collector, scope);

        // Step 2: Resolve dynamic tools (@[tool{...}])
        result = await this.resolveDynamicTools(result, allowedUris, mode, collector);
        
        return result;
    }

    /**
     * @description Parse references in user prompt, collect context items
     * @param text - User prompt text
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param scope - Optional macro scope for passing macro definitions
     * @returns {Promise<ContextItem[]>} Collected context items
     */
    static async resolveContext(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        scope?: MacroScope
    ): Promise<ContextItem[]> {
        const collector: ContextItem[] = [];
        await this.assembleDocument(text, workspaceRoot, allowedUris, ParseMode.APPEND, collector, scope);
        return collector;
    }

    // Deprecated: Kept for compatibility if needed
    static async resolveUserPromptReferences(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[]
    ): Promise<string> {
        const collector = await this.resolveContext(text, workspaceRoot, allowedUris);
        if (collector.length === 0) return '';
        
        return ['### User Provided Context References:', '', ...collector.map(item => {
            if (item.type === 'file') {
                return `#### Source: ${item.key}\n\n\`\`\`\n${item.content}\n\`\`\``;
            } else {
                const argsString = typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata);
                return `#### Tool Call: ${item.key}\n> Args: ${argsString}\n\n\`\`\`\n${item.content}\n\`\`\``;
            }
        })].join('\n');
    }

    /**
     * @description Resolve static file references @[path]
     * Called at User Prompt level. When it encounters @[path] (without {), it:
     * 1. Reads the file
     * 2. Uses that file as root to call Preprocessor.process
     * Recursive resolution is now handled by Preprocessor
     */
    static async resolveStaticIncludes(
        text: string,
        rootUri: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode,
        collector?: ContextItem[],
        scope?: MacroScope
    ): Promise<string> {
        if (!text.includes('@[')) return text;

        let result = '';
        let lastIndex = 0;

        // Create readFile function for Preprocessor
        const readFile = async (uri: vscode.Uri): Promise<string> => {
            const bytes = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(bytes);
        };

        let i = 0;
        while (i < text.length) {
            const start = text.indexOf('@[', i);
            if (start === -1) {
                result += text.substring(lastIndex);
                break;
            }

            const { content, endIdx } = extractBracketContent(text, start + 2);
            if (endIdx === -1) {
                i = start + 2;
                continue;
            }

            result += text.substring(lastIndex, start);

            const braceStart = content.indexOf('{');

            if (braceStart !== -1) {
                // This might be a tool call, but we need to preprocess it first
                // to expand any @{recall ...} or other macro commands in the arguments
                const preprocessor = new Preprocessor(readFile, rootUri, rootUri, scope); // tool call context has no specific file, use root
                const { result: processedContent } = await preprocessor.process(content);
                
                // After preprocessing, if it still looks like a tool call (contains {), preserve it
                // Otherwise, it might have been transformed into something else
                if (processedContent.includes('{')) {
                    result += '@[' + processedContent + ']';
                } else {
                    // It was transformed into a file path or something else, treat as include
                    try {
                        const { uri, startLine, endLine } = parseReference(processedContent, rootUri);
                        const rawContent = await readResource(uri, startLine, endLine);
                        const childPreprocessor = new Preprocessor(readFile, rootUri, uri, scope);
                        const { result: rawProcessed } = await childPreprocessor.process(rawContent);
                        // Resolve dynamic tools within the file content
                        const finalContent = await this.resolveDynamicTools(rawProcessed, allowedUris, ParseMode.INLINE, undefined);
                        
                        if (mode === ParseMode.INLINE) {
                            result += finalContent;
                        } else {
                            if (collector) {
                                collector.push({ type: 'file', key: processedContent, content: finalContent });
                            }
                            result += '@[' + processedContent + ']';
                        }
                    } catch (e) {
                        result += `> Error including ${processedContent}: ${(e as Error).message}`;
                    }
                }
            } else {
                // Static file reference @[path]
                try {
                    const { uri, startLine, endLine } = parseReference(content, rootUri);
                    
                    // Read file content
                    const rawContent = await readResource(uri, startLine, endLine);

                    // Create Preprocessor with this file as root
                    // The Preprocessor will handle recursive includes and macro processing
                    // Pass the scope to inherit macro definitions from parent context
                    const preprocessor = new Preprocessor(readFile, rootUri, uri, scope);
                    const { result: rawProcessed, warnings } = await preprocessor.process(rawContent);

                    // Resolve dynamic tools within the file content
                    const finalContent = await this.resolveDynamicTools(rawProcessed, allowedUris, ParseMode.INLINE, undefined);

                    if (mode === ParseMode.INLINE) {
                        result += finalContent;
                    } else {
                        // Append to collector
                        if (collector) {
                            collector.push({
                                type: 'file',
                                key: content,
                                content: finalContent
                            });
                        }
                        // Keep original tag in text
                        result += text.substring(start, endIdx + 1);
                    }
                } catch (e) {
                    const errorMessage = `> Error including ${content}: ${(e as Error).message}`;
                    if (mode === ParseMode.INLINE) {
                        result += errorMessage;
                    } else {
                        if (collector) {
                            collector.push({
                                type: 'file',
                                key: content,
                                content: errorMessage
                            });
                        }
                        result += text.substring(start, endIdx + 1);
                    }
                }
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return result;
    }

    /**
     * @description Resolve dynamic tool calls @[tool{...}]
     * Called as the final step in the processing pipeline
     */
    static async resolveDynamicTools(
        text: string,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[]
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

            const { content, endIdx } = extractBracketContent(text, start + 2);
            if (endIdx === -1) {
                i = start + 2;
                continue;
            }

            result += text.substring(lastIndex, start);

            const braceStart = content.indexOf('{');
            const braceEnd = content.lastIndexOf('}');

            if (braceStart !== -1 && braceEnd !== -1 && braceStart < braceEnd) {
                // This is a dynamic tool call @[tool{...}]
                const toolName = content.substring(0, braceStart).trim();
                const jsonArgs = content.substring(braceStart, braceEnd + 1);

                try {
                    const args = JSON.parse(jsonArgs);
                    const output = await executeToolCall(toolName, args, allowedUris);

                    if (mode === ParseMode.INLINE) {
                        result += output;
                    } else {
                        if (collector) {
                            collector.push({
                                type: 'tool',
                                key: toolName,
                                content: output,
                                metadata: args
                            });
                        }
                        result += text.substring(start, endIdx + 1);
                    }
                } catch (e: any) {
                    const errorMessage = `> Error executing ${toolName}: ${e.message}`;
                    if (mode === ParseMode.INLINE) {
                        result += errorMessage;
                    } else {
                        if (collector) {
                            collector.push({
                                type: 'tool',
                                key: toolName,
                                content: errorMessage,
                                metadata: jsonArgs
                            });
                        }
                        result += text.substring(start, endIdx + 1);
                    }
                }
            } else {
                // Not a dynamic tool call, preserve as-is
                result += text.substring(start, endIdx + 1);
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return result;
    }
}
