import * as vscode from 'vscode';

/**
 * @description Regex pattern for matching define commands. Format: define MACRO_NAME, "value"
 */
const DEFINE_REGEX = /^define\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*"([^"]*)"\s*$/;

/**
 * @description Regex pattern for matching ifdef commands. Format: ifdef MACRO_NAME
 */
const IFDEF_REGEX = /^ifdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * @description Regex pattern for matching ifndef commands. Format: ifndef MACRO_NAME
 */
const IFNDEF_REGEX = /^ifndef\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * @description Regex pattern for matching endif commands. Format: endif
 */
const ENDIF_REGEX = /^endif\s*$/;

/**
 * @description Regex pattern for matching else commands. Format: else
 */
const ELSE_REGEX = /^else\s*$/;

/**
 * @description Regex pattern for matching if condition commands.
 * Format: if MACRO_NAME (IS|CONTAINS|MATCHES|ISNT|DOESNT_CONTAIN|DOESNT_MATCH) (MACRO_NAME|"string")
 */
const IF_REGEX = /^if\s+([A-Za-z_][A-Za-z0-9_]*)\s+(IS|CONTAINS|MATCHES|ISNT|DOESNT_CONTAIN|DOESNT_MATCH)\s+([A-Za-z_][A-Za-z0-9_]*|"[^"]*")\s*$/;

/**
 * @description Regex pattern for matching recall commands. Format: recall MACRO_NAME
 */
const RECALL_REGEX = /^recall\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * @description Regex pattern for extracting define commands from text blocks.
 * Format: @{define MACRO_NAME, "value"}
 */
const DEFINE_BLOCK_REGEX = /@\{define\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*"([^"]*)"\s*\}/g;

/**
 * @description Maximum recursion depth for file includes
 */
const MAX_INCLUDE_DEPTH = 20;

/**
 * @description Interface for macro scope supporting parent-child chain
 */
export interface MacroScope {
    /** @description Get the value of a macro */
    get(name: string): string | undefined;
    /** @description Set a macro value in current scope */
    set(name: string, value: string): void;
    /** @description Check if a macro exists in current or parent scopes */
    has(name: string): boolean;
    /** @description Create a child scope */
    createChild(): MacroScope;
}

/**
 * @description Implementation of MacroScope with parent-child chain support
 */
class MacroScopeImpl implements MacroScope {
    private macros: Map<string, string>;
    private parent?: MacroScope;

    constructor(parent?: MacroScope) {
        this.macros = new Map();
        this.parent = parent;
    }

    get(name: string): string | undefined {
        const value = this.macros.get(name);
        if (value !== undefined) {
            return value;
        }
        if (this.parent) {
            return this.parent.get(name);
        }
        return undefined;
    }

    set(name: string, value: string): void {
        this.macros.set(name, value);
    }

    has(name: string): boolean {
        return this.macros.has(name) || (this.parent?.has(name) ?? false);
    }

    createChild(): MacroScope {
        return new MacroScopeImpl(this);
    }
}

/**
 * @description Represents a frame in the conditional processing stack.
 * Tracks the state of conditional blocks like ifdef, ifndef, and if.
 */
interface ConditionFrame {
    /** @description The type of conditional directive that created this frame */
    type: 'ifdef' | 'ifndef' | 'if';
    /** @description Whether the condition evaluated to true */
    conditionMet: boolean;
    /** @description Whether this frame is currently active (content should be processed) */
    currentlyActive: boolean;
    /** @description Whether an else directive has been encountered for this frame */
    hasElse: boolean;
}

/**
 * @description Extract all macro definitions from text.
 * Searches for all occurrences of @{define MACRO_NAME, "value"} in the text
 * and returns them as a Map of macro names to their values.
 * @param {string} text - The input text to search for define commands
 * @returns {Map<string, string>} Map of macro names to their values
 */
export function extractMacroDefinitions(text: string): Map<string, string> {
    const macros = new Map<string, string>();
    let match: RegExpExecArray | null;

    // Reset lastIndex to ensure the regex starts from the beginning
    DEFINE_BLOCK_REGEX.lastIndex = 0;

    while ((match = DEFINE_BLOCK_REGEX.exec(text)) !== null) {
        const name = match[1];
        const value = match[2];
        macros.set(name, value);
    }

    return macros;
}

/**
 * @description Result of preprocessing a text, containing the processed content and any warnings.
 */
export interface PreprocessorResult {
    /** @description The processed text after applying all conditional directives */
    result: string;
    /** @description Array of warning messages generated during preprocessing */
    warnings: string[];
}

/**
 * @description A preprocessor that handles conditional compilation directives.
 * Supports define, ifdef, ifndef, if, else, endif, recall commands within @{...} blocks,
 * and file includes via @[...] syntax.
 * Allows conditional inclusion/exclusion of text based on macro definitions.
 */
export class Preprocessor {
    private scope: MacroScope;
    private readFile: (uri: vscode.Uri) => Promise<string>;
    private rootUri: vscode.Uri;
    private currentFileUri: vscode.Uri;
    private includeDepth: number;

    /**
     * @description Creates a new Preprocessor instance.
     * @param {function} readFile - Function to read file content for includes
     * @param {vscode.Uri} rootUri - Workspace root URI for absolute path resolution
     * @param {vscode.Uri} currentFileUri - Current file URI for relative path resolution
     * @param {MacroScope} [scope] - Optional parent macro scope
     * @param {number} [includeDepth] - Current include depth for recursion tracking
     */
    constructor(
        readFile: (uri: vscode.Uri) => Promise<string>,
        rootUri: vscode.Uri,
        currentFileUri: vscode.Uri,
        scope?: MacroScope,
        includeDepth: number = 0
    ) {
        this.readFile = readFile;
        this.rootUri = rootUri;
        this.currentFileUri = currentFileUri;
        this.scope = scope ? scope.createChild() : new MacroScopeImpl();
        this.includeDepth = includeDepth;
    }

    /**
     * @description Get the internal MacroScope (useful for sharing context)
     * @returns {MacroScope} The MacroScope used by this preprocessor
     */
    getScope(): MacroScope {
        return this.scope;
    }

    /**
     * @description Find the matching closing bracket using stack-based matching.
     * Handles nested braces for both {} and [].
     * @param text - The text to search
     * @param start - Start position (after the opening bracket)
     * @param openChar - Opening bracket character ('{' or '[')
     * @param closeChar - Closing bracket character ('}' or ']')
     * @returns Position of closing bracket, or -1 if not found
     */
    private findMatchingBracket(text: string, start: number, openChar: string, closeChar: string): number {
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === openChar) {
                depth++;
            } else if (text[i] === closeChar) {
                if (depth === 0) {
                    return i;
                }
                depth--;
            }
        }
        return -1;
    }

    /**
     * @description Process a text containing conditional directives.
     * Parses @{...} command blocks and applies conditional logic based on macro definitions.
     * Also handles @[filepath] for file includes and @[tool{...}] is preserved as-is.
     * Uses stack-based matching for nested brackets.
     * @param {string} text - The input text to process.
     * @returns {Promise<PreprocessorResult>} The result containing processed text and any warnings.
     */
    async process(text: string): Promise<PreprocessorResult> {
        const warnings: string[] = [];
        const stack: ConditionFrame[] = [];
        let result = '';
        let index = 0;

        while (index < text.length) {
            // Check for @{ command
            const cmdStart = text.indexOf('@{', index);
            // Check for @[ include/tool
            const includeStart = text.indexOf('@[', index);

            // Find the closest occurrence
            let start = -1;
            let isInclude = false;

            if (cmdStart !== -1 && includeStart !== -1) {
                if (cmdStart < includeStart) {
                    start = cmdStart;
                    isInclude = false;
                } else {
                    start = includeStart;
                    isInclude = true;
                }
            } else if (cmdStart !== -1) {
                start = cmdStart;
                isInclude = false;
            } else if (includeStart !== -1) {
                start = includeStart;
                isInclude = true;
            }

            if (start === -1) {
                // No more commands, add remaining text if active
                if (this.isActive(stack)) {
                    result += text.substring(index);
                }
                break;
            }

            // Add text between last position and this command
            if (this.isActive(stack)) {
                result += text.substring(index, start);
            }

            // Find the matching closing bracket using stack-based matching
            // For @{} use '{' and '}', for @[] use '[' and ']'
            const openChar = isInclude ? '[' : '{';
            const closeChar = isInclude ? ']' : '}';
            const end = this.findMatchingBracket(text, start + 2, openChar, closeChar);
            
            if (end === -1) {
                warnings.push(`Unclosed ${isInclude ? '@[' : '@{'} block`);
                if (this.isActive(stack)) {
                    result += text.substring(start);
                }
                break;
            }

            const content = text.substring(start + 2, end);

            if (isInclude) {
                // Handle @[...] syntax
                // First, preprocess the content to expand any @{recall ...} or other commands
                let processedContent = content;
                if (content.includes('@{') && this.isActive(stack)) {
                    // Create a temporary preprocessor with current scope to expand nested commands
                    const tempPreprocessor = new Preprocessor(
                        this.readFile,
                        this.rootUri,
                        this.currentFileUri,
                        this.scope,
                        this.includeDepth // Don't increase depth for content preprocessing
                    );
                    const tempResult = await tempPreprocessor.process(content);
                    processedContent = tempResult.result;
                }

                // After preprocessing, check if it's a tool call or file include
                if (processedContent.includes('{')) {
                    // Contains { - this is a tool call, preserve as-is (with expanded content)
                    if (this.isActive(stack)) {
                        result += '@[' + processedContent + ']';
                    }
                } else {
                    // No { - this is a file include
                    if (this.isActive(stack)) {
                        const includeResult = await this.handleInclude(processedContent, warnings);
                        result += includeResult;
                    }
                }
            } else {
                // Handle @{...} command
                const { handled, output } = this.handleCommand(content, stack, warnings);

                if (output !== undefined && this.isActive(stack)) {
                    result += output;
                }

                if (!handled && this.isActive(stack)) {
                    result += text.substring(start, end + 1);
                }

                // If this was a define command and there's a newline right after it, skip it
                // to prevent leading empty lines in the result
                if (handled && content.startsWith('define') && end + 1 < text.length && text[end + 1] === '\n') {
                    index = end + 2;
                    continue;
                }
            }

            index = end + 1;
        }

        if (stack.length > 0) {
            warnings.push('Unclosed conditional block.');
        }

        return { result, warnings };
    }

    /**
     * @description Handle a file include @[filepath] command.
     * @param {string} filepath - The file path (may be relative)
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {Promise<string>} The processed content of the included file.
     */
    private async handleInclude(filepath: string, warnings: string[]): Promise<string> {
        // Check recursion depth
        if (this.includeDepth >= MAX_INCLUDE_DEPTH) {
            warnings.push(`Maximum include depth (${MAX_INCLUDE_DEPTH}) exceeded for: ${filepath}`);
            return '';
        }

        // Trim whitespace from filepath
        filepath = filepath.trim();

        if (!filepath) {
            warnings.push('Empty include path');
            return '';
        }

        const tryInclude = async (uri: vscode.Uri): Promise<string | null> => {
            try {
                const content = await this.readFile(uri);
                const childPreprocessor = new Preprocessor(
                    this.readFile,
                    this.rootUri,
                    uri,
                    this.scope,
                    this.includeDepth + 1
                );
                const childResult = await childPreprocessor.process(content);
                warnings.push(...childResult.warnings);
                return childResult.result;
            } catch (e) {
                return null;
            }
        };

        let result: string | null = null;
        let errors: string[] = [];

        // Strategy 1: If starts with / or ~, relative to root
        if (filepath.startsWith('/') || filepath.startsWith('~/')) {
            const cleanPath = filepath.startsWith('~/') ? filepath.substring(2) : filepath.substring(1);
            const targetUri = vscode.Uri.joinPath(this.rootUri, cleanPath);
            result = await tryInclude(targetUri);
            if (result === null) errors.push(`Root relative: ${targetUri.toString()}`);
        }
        // Strategy 2: If starts with ./ or ../, relative to current file
        else if (filepath.startsWith('./') || filepath.startsWith('../')) {
            const targetUri = vscode.Uri.joinPath(this.currentFileUri, '..', filepath);
            result = await tryInclude(targetUri);
            if (result === null) errors.push(`Relative: ${targetUri.toString()}`);
        }
        // Strategy 3: Bare path - try relative to current, then relative to root
        else {
            // 3a. Relative to current file
            const relativeUri = vscode.Uri.joinPath(this.currentFileUri, '..', filepath);
            result = await tryInclude(relativeUri);
            
            // 3b. If failed, try relative to root
            if (result === null) {
                errors.push(`Relative: ${relativeUri.toString()}`);
                const rootUri = vscode.Uri.joinPath(this.rootUri, filepath);
                result = await tryInclude(rootUri);
                if (result === null) errors.push(`Root: ${rootUri.toString()}`);
            }
        }

        if (result !== null) {
            return result;
        }

        warnings.push(`Failed to include file '${filepath}': ${errors.join(', ')}`);
        return '';
    }

    /**
     * @description Handle a single preprocessor command from within a @{...} block.
     * @param {string} content - The command content (without @{ and }).
     * @param {ConditionFrame[]} stack - The current condition stack.
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {{handled: boolean; output?: string}} Object indicating if command was handled and any output to append.
     */
    private handleCommand(content: string, stack: ConditionFrame[], warnings: string[]): { handled: boolean; output?: string } {
        if (DEFINE_REGEX.test(content)) {
            const match = content.match(DEFINE_REGEX);
            if (!match) return { handled: true };
            if (this.isActive(stack)) {
                const name = match[1];
                const value = match[2];
                this.scope.set(name, value);
            }
            return { handled: true };
        }

        if (IFDEF_REGEX.test(content)) {
            const match = content.match(IFDEF_REGEX);
            if (!match) return { handled: true };
            const name = match[1];
            const conditionMet = this.scope.has(name);
            this.pushFrame(stack, 'ifdef', conditionMet);
            return { handled: true };
        }

        if (IFNDEF_REGEX.test(content)) {
            const match = content.match(IFNDEF_REGEX);
            if (!match) return { handled: true };
            const name = match[1];
            const conditionMet = !this.scope.has(name);
            this.pushFrame(stack, 'ifndef', conditionMet);
            return { handled: true };
        }

        if (IF_REGEX.test(content)) {
            const match = content.match(IF_REGEX);
            if (!match) return { handled: true };
            const leftName = match[1];
            const test = match[2];
            const rightRaw = match[3];

            const leftValue = this.getMacroValue(leftName, warnings);
            const rightValue = this.getRightValue(rightRaw, warnings);

            const conditionMet = this.evaluateCondition(leftValue, test, rightValue, warnings);
            this.pushFrame(stack, 'if', conditionMet);
            return { handled: true };
        }

        if (RECALL_REGEX.test(content)) {
            const match = content.match(RECALL_REGEX);
            if (!match) return { handled: true };
            if (this.isActive(stack)) {
                const name = match[1];
                const value = this.scope.get(name);
                if (value !== undefined) {
                    // recall 应该将宏值输出到结果中
                    return { handled: true, output: value };
                } else {
                    warnings.push(`Macro '${name}' not defined for recall.`);
                }
            }
            return { handled: true };
        }

        if (ELSE_REGEX.test(content)) {
            if (stack.length === 0) {
                warnings.push('Unmatched else encountered.');
                return { handled: true };
            }

            const frame = stack[stack.length - 1];
            if (frame.hasElse) {
                warnings.push('Duplicate else encountered in the same conditional block.');
                return { handled: true };
            }

            frame.hasElse = true;
            const parentActive = stack.length > 1 ? stack[stack.length - 2].currentlyActive : true;
            frame.currentlyActive = parentActive && !frame.conditionMet;
            return { handled: true };
        }

        if (ENDIF_REGEX.test(content)) {
            if (stack.length === 0) {
                warnings.push('Unmatched endif encountered.');
                return { handled: true };
            }
            stack.pop();
            return { handled: true };
        }

        warnings.push(`Invalid command syntax: @\{${content}}`);
        return { handled: false };
    }

    /**
     * @description Push a new condition frame onto the stack.
     * @param {ConditionFrame[]} stack - The condition stack to push to.
     * @param {ConditionFrame['type']} type - The type of condition (ifdef, ifndef, or if).
     * @param {boolean} conditionMet - Whether the condition evaluated to true.
     */
    private pushFrame(stack: ConditionFrame[], type: ConditionFrame['type'], conditionMet: boolean): void {
        const parentActive = this.getParentActive(stack);
        const frame: ConditionFrame = {
            type,
            conditionMet,
            currentlyActive: parentActive && conditionMet,
            hasElse: false
        };
        stack.push(frame);
    }

    /**
     * @description Get the active state of the parent frame.
     * @param {ConditionFrame[]} stack - The condition stack.
     * @returns {boolean} True if the parent is active or there is no parent (root level).
     */
    private getParentActive(stack: ConditionFrame[]): boolean {
        if (stack.length === 0) return true;
        return stack[stack.length - 1].currentlyActive;
    }

    /**
     * @description Check if processing is currently active at the current stack level.
     * @param {ConditionFrame[]} stack - The condition stack.
     * @returns {boolean} True if the current context allows processing, false otherwise.
     */
    private isActive(stack: ConditionFrame[]): boolean {
        if (stack.length === 0) return true;
        return stack[stack.length - 1].currentlyActive;
    }

    /**
     * @description Get the value of a macro, logging a warning if not defined.
     * @param {string} name - The name of the macro to retrieve.
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {string} The macro value, or empty string if not defined.
     */
    private getMacroValue(name: string, warnings: string[]): string {
        const value = this.scope.get(name);
        if (value === undefined) {
            warnings.push(`Macro '${name}' is not defined.`);
            return '';
        }
        return value;
    }

    /**
     * @description Get the right-hand side value for a condition, handling both macros and string literals.
     * @param {string} raw - The raw value string (either a macro name or a quoted string).
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {string} The resolved value.
     */
    private getRightValue(raw: string, warnings: string[]): string {
        if (raw.startsWith('"') && raw.endsWith('"')) {
            return raw.substring(1, raw.length - 1);
        }
        return this.getMacroValue(raw, warnings);
    }

    /**
     * @description Evaluate a condition by comparing two values using the specified test operator.
     * @param {string} leftValue - The left-hand side value.
     * @param {string} test - The comparison operator (IS, ISNT, CONTAINS, DOESNT_CONTAIN, MATCHES, DOESNT_MATCH).
     * @param {string} rightValue - The right-hand side value.
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {boolean} The result of the condition evaluation.
     */
    private evaluateCondition(leftValue: string, test: string, rightValue: string, warnings: string[]): boolean {
        switch (test) {
            case 'IS':
                return leftValue === rightValue;
            case 'ISNT':
                return leftValue !== rightValue;
            case 'CONTAINS':
                return leftValue.includes(rightValue);
            case 'DOESNT_CONTAIN':
                return !leftValue.includes(rightValue);
            case 'MATCHES':
                return this.matchesRegex(leftValue, rightValue, warnings);
            case 'DOESNT_MATCH':
                return !this.matchesRegex(leftValue, rightValue, warnings);
            default:
                return false;
        }
    }

    /**
     * @description Test if a value matches a regular expression pattern.
     * @param {string} value - The string to test.
     * @param {string} pattern - The regular expression pattern.
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {boolean} True if the value matches the pattern, false otherwise.
     */
    private matchesRegex(value: string, pattern: string, warnings: string[]): boolean {
        try {
            const regex = new RegExp(pattern);
            return regex.test(value);
        } catch (error) {
            warnings.push(`Regex error: ${(error as Error).message}`);
            return false;
        }
    }
}

/**
 * @description Legacy MacroContext class for backward compatibility.
 * Also implements MacroScope interface for direct use in preprocessor pipeline.
 */
export class MacroContext implements MacroScope {
    private scope: MacroScope;
    private localMacros: Map<string, string>; // Track macros for getMacrosObject

    /**
     * @description Creates a new MacroContext instance with an empty macro map.
     */
    constructor() {
        this.scope = new MacroScopeImpl();
        this.localMacros = new Map();
    }

    // MacroScope interface implementation
    get(name: string): string | undefined {
        return this.scope.get(name);
    }

    set(name: string, value: string): void {
        this.scope.set(name, value);
        this.localMacros.set(name, value);
    }

    has(name: string): boolean {
        return this.scope.has(name);
    }

    createChild(): MacroScope {
        return this.scope.createChild();
    }

    /**
     * @description Define a macro, map its name to a string value.
     * @param {string} name - Name of the macro, must consist of upper case letters, numbers and underscores.
     * @param {string} value - The string value to associate with the macro.
     */
    define(name: string, value: string): void {
        this.set(name, value);
    }

    /**
     * @description Check if a macro is defined.
     * @param {string} name - The name of the macro to check.
     * @returns {boolean} True if the macro exists, false otherwise.
     */
    isDefined(name: string): boolean {
        return this.has(name);
    }

    /**
     * @description Get the value of a defined macro.
     * @param {string} name - The name of the macro to retrieve.
     * @returns {string | undefined} The macro value if defined, undefined otherwise.
     */
    getValue(name: string): string | undefined {
        return this.get(name);
    }

    /**
     * @description Set multiple macros from a plain object (for deserialization)
     * @param {Record<string, string>} macros - Record of macro names to values
     */
    setMacros(macros: Record<string, string>): void {
        for (const [name, value] of Object.entries(macros)) {
            this.set(name, value);
        }
    }

    /**
     * @description Get all macros as a plain object (for serialization)
     * @returns {Record<string, string>} Record of macro names to values
     */
    getMacrosObject(): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [name, value] of this.localMacros.entries()) {
            result[name] = value;
        }
        return result;
    }

    /**
     * @description Clear all macro definitions
     */
    clear(): void {
        // Create a new scope to clear
        this.scope = new MacroScopeImpl();
        this.localMacros.clear();
    }
}
