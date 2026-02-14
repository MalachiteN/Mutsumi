import * as vscode from 'vscode';
const matter = require('gray-matter');
import { Preprocessor, MacroContext } from './preprocessor';
import {
    extractBracketContent,
    parseReference,
    readResource,
    isMarkdownFile,
    shouldRecurseFile,
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

// ContextItem is now defined in types.ts
import { ContextItem } from '../types';
export { ContextItem };

/**
 * Result of parsing static includes
 * @description Contains the parsed content and collected front matter params
 */
interface StaticIncludeResult {
    /** Parsed content with includes resolved */
    content: string;
    /** Collected Params from all Markdown files' front matter */
    params: string[];
}

/**
 * Result of prepareSkill
 * @description Contains the final content, description from top-level file, and merged params
 */
interface PrepareSkillResult {
    /** Assembled content */
    content: string;
    /** Description from the top-level Markdown file's front matter (empty string if not found) */
    description: string;
    /** All collected and deduplicated Params from all levels */
    params: string[];
}

/**
 * Context Assembler Class
 * @description Responsible for parsing and assembling dynamic context, supports file reference @[path] and tool call @[tool] syntax
 */
export class ContextAssembler {

    /**
     * @description Run preprocessor to process @{...} syntax
     * @param text - Text to preprocess
     * @param macroContext - Optional external MacroContext to use (for sharing macros across files)
     */
    static preprocess(text: string, macroContext?: MacroContext): string {
        if (!text.includes('@{')) {
            return text;
        }
        const preprocessor = new Preprocessor(macroContext);
        const { result: preprocessedText } = preprocessor.process(text);
        return preprocessedText;
    }

    /**
     * @description Parse and resolve static file references @[path] and dynamic tool calls @[tool]
     */
    static async prepareSkill(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[]
    ): Promise<PrepareSkillResult> {
        // Step 0: Parse top-level front matter
        let content = text;
        let description = '';
        let topLevelParams: string[] = [];

        try {
            if (text.startsWith('---')) {
                const parsed = matter(text);
                content = parsed.content;
                if (parsed.data) {
                    if (typeof parsed.data.Description === 'string') {
                        description = parsed.data.Description;
                    }
                    if (Array.isArray(parsed.data.Params)) {
                        topLevelParams = parsed.data.Params.filter((p: any) => typeof p === 'string');
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing top-level front matter:', e);
        }

        if (!content.includes('@[')) {
            return { content: content, description, params: topLevelParams };
        }

        // Step 1: Recursively resolve all static file references (flatten)
        const staticResult = await this.resolveStaticIncludes(
            content,
            workspaceRoot,
            allowedUris,
            0,
            mode,
            collector
        );

        // Step 2: Resolve all dynamic tool calls in the flattened text
        const resolvedText = await this.resolveDynamicTools(
            staticResult.content,
            allowedUris,
            mode,
            collector
        );

        // Merge and deduplicate params
        const allParams = [...topLevelParams, ...staticResult.params];
        const uniqueParams = [...new Set(allParams)];

        if (mode === ParseMode.APPEND) {
            return { content: text, description, params: uniqueParams };
        }
        return { content: resolvedText, description, params: uniqueParams };
    }

    /**
     * @description Assemble document with full pipeline
     * @param text - Document text to process
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param mode - Parse mode (INLINE or APPEND)
     * @param collector - Optional context item collector
     * @param macroContext - Optional shared MacroContext for cross-file macro definitions
     */
    static async assembleDocument(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        mode: ParseMode = ParseMode.INLINE,
        collector?: ContextItem[],
        macroContext?: MacroContext
    ): Promise<string> {
        // Step 1: Run preprocessor
        text = this.preprocess(text, macroContext);

        // Step 2: Run prepareSkill
        const result = await this.prepareSkill(text, workspaceRoot, allowedUris, mode, collector);
        
        return result.content;
    }

    /**
     * @description Parse references in user prompt, collect context items
     * @returns {Promise<ContextItem[]>} Collected context items
     */
    static async resolveContext(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[]
    ): Promise<ContextItem[]> {
        const collector: ContextItem[] = [];
        await this.assembleDocument(text, workspaceRoot, allowedUris, ParseMode.APPEND, collector);
        return collector;
    }

    /**
     * @description Parse references in user prompt, collect context items with macro support
     * @param text - User prompt text
     * @param workspaceRoot - Workspace root URI
     * @param allowedUris - Allowed URIs for security
     * @param macroContext - Optional shared MacroContext
     * @returns Collected context items
     */
    static async resolveContextWithMacros(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[],
        macroContext?: MacroContext
    ): Promise<ContextItem[]> {
        const collector: ContextItem[] = [];
        await this.assembleDocument(
            text,
            workspaceRoot,
            allowedUris,
            ParseMode.APPEND,
            collector,
            macroContext
        );
        return collector;
    }

    // Deprecated: Kept for compatibility if needed, but logic moved to resolveContext
    static async resolveUserPromptReferences(
        text: string,
        workspaceRoot: vscode.Uri,
        allowedUris: string[]
    ): Promise<string> {
        // This function is deprecated in favor of manual context assembly in history.ts
        // But to keep signature valid:
        const collector = await this.resolveContext(text, workspaceRoot, allowedUris);
        if (collector.length === 0) return '';
        
        // Convert collector back to string format (legacy behavior)
        return ['### User Provided Context References:', '', ...collector.map(item => {
            if (item.type === 'file') {
                return `#### Source: ${item.key}\n\n\`\`\`\n${item.content}\n\`\`\``;
            } else {
                const argsString = typeof item.metadata === 'string' ? item.metadata : JSON.stringify(item.metadata);
                return `#### Tool Call: ${item.key}\n> Args: ${argsString}\n\n\`\`\`\n${item.content}\n\`\`\``;
            }
        })].join('\n');
    }

    private static async resolveStaticIncludes(
        text: string,
        rootUri: vscode.Uri,
        allowedUris: string[],
        depth: number,
        mode: ParseMode,
        collector?: ContextItem[]
    ): Promise<StaticIncludeResult> {
        if (depth > 20) return { content: text, params: [] };
        if (!text.includes('@[')) return { content: text, params: [] };

        let result = '';
        let lastIndex = 0;
        let hasChanges = false;
        const allParams: string[] = [];

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
                // Tool call, preserve for dynamic parsing
                result += text.substring(start, endIdx + 1);
            } else {
                // Static file reference
                try {
                    const { uri, startLine, endLine } = parseReference(content, rootUri);
                    const rawContent = await readResource(uri, startLine, endLine);
                    
                    const isMd = isMarkdownFile(uri);
                    let fileParams: string[] = [];
                    let processedContent = rawContent;

                    if (isMd) {
                        const parsed = matter(rawContent);
                        processedContent = parsed.content;
                        if (parsed.data && Array.isArray(parsed.data.Params)) {
                            fileParams = parsed.data.Params.filter((p: any) => typeof p === 'string');
                        }
                    }

                    const shouldRecurse = shouldRecurseFile(uri);
                    let flattenedContent: string;
                    let childParams: string[] = [];
                    
                    if (shouldRecurse) {
                        const childResult = await this.resolveStaticIncludes(
                            processedContent,
                            rootUri,
                            allowedUris,
                            depth + 1,
                            ParseMode.INLINE, // Always inline children for the content
                            undefined
                        );
                        flattenedContent = childResult.content;
                        childParams = childResult.params;
                    } else {
                        flattenedContent = processedContent;
                    }

                    const mergedParams = [...fileParams, ...childParams];
                    allParams.push(...mergedParams);

                    // When appending, we want the FULL resolved content of the file
                    // which means any tools inside it should also be resolved.
                    const resolvedContent = await this.resolveDynamicTools(flattenedContent, allowedUris, ParseMode.INLINE);

                    if (mode === ParseMode.INLINE) {
                        result += resolvedContent;
                    } else {
                        // Append to collector
                        if (collector) {
                            collector.push({
                                type: 'file',
                                key: content,
                                content: resolvedContent
                            });
                        }
                        // Keep original tag in text
                        result += text.substring(start, endIdx + 1);
                    }

                    hasChanges = true;
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

        const uniqueParams = [...new Set(allParams)];

        if (mode === ParseMode.APPEND) {
            return { content: text, params: uniqueParams };
        }

        return { 
            content: hasChanges ? result : text, 
            params: uniqueParams
        };
    }

    private static async resolveDynamicTools(
        text: string,
        allowedUris: string[],
        mode: ParseMode,
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
                result += text.substring(start, endIdx + 1);
            }

            lastIndex = endIdx + 1;
            i = lastIndex;
        }

        return mode === ParseMode.APPEND ? text : result;
    }
}
