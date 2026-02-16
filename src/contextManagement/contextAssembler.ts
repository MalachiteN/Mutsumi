import * as vscode from 'vscode';
const matter = require('gray-matter');
import * as pp from 'preprocess';
import {
    extractBracketContent,
    parseReference,
    readResource,
    isMarkdownFile,
    executeToolCall,
    extractMacroDefinitions
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
 * @description Responsible for parsing and assembling dynamic context, supports file reference @[...] and tool call > Error executing tool: Expected property name or '}' in JSON at position 1 (line 1 column 2) syntax
 */
export class ContextAssembler {

    /**
     * @description Assemble document with full pipeline
     * @param text - Document text to process
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param mode - Parse mode (INLINE or APPEND)
     * @param collector - Optional context item collector
     * @param context - Optional context object for macro definitions
     */
    static async assembleDocument(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[],
        context?: Record<string, any>
    ): Promise<string> {
        // Step 1: Extract Macros from the current text if not provided or merge
        const localMacros = extractMacroDefinitions(text);
        const effectiveContext = { ...(context || {}), ...localMacros };

        // Step 2: Resolve static includes (@[...] without {args}) and static file reads
        // This will also recursively resolve includes and preprocess content
        let result = await this.resolveStaticIncludes(text, workspaceRoot, allowedUris, mode, collector, effectiveContext);

        // Step 3: Resolve dynamic tools (> Error executing tool: Expected property name or '}' in JSON at position 1 (line 1 column 2))
        result = await this.resolveDynamicTools(result, allowedUris, mode, collector, effectiveContext);
        
        return result;
    }

    /**
     * @description Parse references in user prompt, collect context items
     * @param text - User prompt text
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param context - Optional context object for macro definitions
     * @returns {Promise<ContextItem[]>} Collected context items
     */
    static async resolveContext(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        context?: Record<string, any>
    ): Promise<ContextItem[]> {
        const collector: ContextItem[] = [];
        await this.assembleDocument(text, workspaceRoot, allowedUris, ParseMode.APPEND, collector, context);
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
     * @description Resolve static file references @[...]
     * Called at User Prompt level. When it encounters @[...] (without {), it:
     * 1. Reads the file
     * 2. Uses preprocess library to handle macro processing
     * 3. Recursively assembles the included content (resolving nested tools and includes)
     */
    static async resolveStaticIncludes(
        text: string,
        rootUri: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode,
        collector?: ContextItem[],
        context?: Record<string, any>
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

            if (braceStart !== -1) {
                // This might be a tool call, but we need to preprocess it first
                // Use html type to prevent stripping // in paths/urls
                const processedContent = pp.preprocess(content, context || {}, { type: 'html' });
                
                if (processedContent.includes('{')) {
                    // Still looks like a tool call, leave for resolveDynamicTools
                    result += '@[' + processedContent + ']';
                } else {
                    // Transformed into a file path
                    try {
                        result += await this.processFileInclude(processedContent, rootUri, allowedUris, mode, collector, context);
                    } catch (err: any) {
                        result += `> Error including ${processedContent}: ${err.message}`;
                    }
                }
            } else {
                // Static file reference @[path]
                // Use html type to prevent stripping // in paths/urls
                const processedPath = pp.preprocess(content, context || {}, { type: 'html' });
                try {
                    result += await this.processFileInclude(processedPath, rootUri, allowedUris, mode, collector, context);
                } catch (err: any) {
                    const msg = `> Error including ${processedPath}: ${err.message}`;
                    if (mode === ParseMode.INLINE) result += msg;
                    else {
                        if (collector) collector.push({ type: 'file', key: processedPath, content: msg });
                        result += text.substring(start, endIdx + 1);
                    }
                }
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return result;
    }

    // Helper to process a single file include
    private static async processFileInclude(
        filePath: string,
        rootUri: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode,
        collector?: ContextItem[],
        context?: Record<string, any>
    ): Promise<string> {
        const { uri, startLine, endLine } = parseReference(filePath, rootUri);
        
        // Read file content
        const rawContent = await readResource(uri, startLine, endLine);

        // Determine preprocess type based on file extension
        const ext = uri.path.split('.').pop()?.toLowerCase();
        let ppType = 'js';
        if (ext && ['md', 'markdown', 'html', 'xml', 'txt'].includes(ext)) {
            ppType = 'html';
        } else if (ext && ['sh', 'yaml', 'yml', 'py', 'rb', 'pl'].includes(ext)) {
            ppType = 'shell';
        }

        // Preprocess macros
        const rawProcessed = pp.preprocess(rawContent, context || {}, { type: ppType });

        // Recursively assemble content (ALWAYS INLINE for included content)
        // Included content should be fully expanded before being added to collector or result
        const finalContent = await this.assembleDocument(
            rawProcessed, 
            rootUri, 
            allowedUris, 
            ParseMode.INLINE, 
            undefined, // No collector for nested includes, they are merged into finalContent
            context
        );

        if (mode === ParseMode.INLINE) {
            return finalContent;
        } else {
            if (collector) {
                collector.push({
                    type: 'file',
                    key: filePath,
                    content: finalContent
                });
            }
            // In APPEND mode, we return the original tag (reconstructed)
            return '@[' + filePath + ']';
        }
    }

    /**
     * @description Resolve dynamic tool calls > Error executing tool: Expected property name or '}' in JSON at position 1 (line 1 column 2)
     * Called as the final step in the processing pipeline
     */
    static async resolveDynamicTools(
        text: string,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[],
        context?: Record<string, any>
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
                // This is a dynamic tool call > Error executing tool: Expected property name or '}' in JSON at position 1 (line 1 column 2)
                
                // Preprocess the content to handle macros in arguments
                // Use html type to prevent stripping // in json strings
                const processedContent = pp.preprocess(content, context || {}, { type: 'html' });
                
                const pBraceStart = processedContent.indexOf('{');
                const pBraceEnd = processedContent.lastIndexOf('}');
                
                if (pBraceStart !== -1 && pBraceEnd !== -1 && pBraceStart < pBraceEnd) {
                     const toolName = processedContent.substring(0, pBraceStart).trim();
                     const jsonArgs = processedContent.substring(pBraceStart, pBraceEnd + 1);

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
                     // Malformed after preprocess, keep as is
                     result += text.substring(start, endIdx + 1);
                }
            } else {
                // Not a dynamic tool call, preserve as-is (might be a file ref that wasn't resolved?)
                result += text.substring(start, endIdx + 1);
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return result;
    }
}
