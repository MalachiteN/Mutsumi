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
 * @description Manages macro definitions and their values.
 * Provides methods to define macros, check if they exist, and retrieve their values.
 */
export class MacroContext {
    private macros: Map<string, string>;

    /**
     * @description Creates a new MacroContext instance with an empty macro map.
     */
    constructor() {
        this.macros = new Map();
    }

    /**
     * @description Define a macro, map its name to a string value.
     * @param {string} name - Name of the macro, must consist of upper case letters, numbers and underscores.
     * @param {string} value - The string value to associate with the macro.
     */
    define(name: string, value: string): void {
        this.macros.set(name, value);
    }

    /**
     * @description Check if a macro is defined.
     * @param {string} name - The name of the macro to check.
     * @returns {boolean} True if the macro exists, false otherwise.
     */
    isDefined(name: string): boolean {
        return this.macros.has(name);
    }

    /**
     * @description Get the value of a defined macro.
     * @param {string} name - The name of the macro to retrieve.
     * @returns {string | undefined} The macro value if defined, undefined otherwise.
     */
    getValue(name: string): string | undefined {
        return this.macros.get(name);
    }
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
 * Supports define, ifdef, ifndef, if, else, and endif commands within @{...} blocks.
 * Allows conditional inclusion/exclusion of text based on macro definitions.
 */
export class Preprocessor {
    private context: MacroContext;

    /**
     * @description Creates a new Preprocessor instance with a fresh MacroContext.
     */
    constructor() {
        this.context = new MacroContext();
    }

    /**
     * @description Process a text containing conditional directives.
     * Parses @{...} command blocks and applies conditional logic based on macro definitions.
     * @param {string} text - The input text to process.
     * @returns {PreprocessorResult} The result containing processed text and any warnings.
     */
    process(text: string): PreprocessorResult {
        const warnings: string[] = [];
        const stack: ConditionFrame[] = [];
        let result = '';
        let index = 0;

        while (index < text.length) {
            const start = text.indexOf('@{', index);
            if (start === -1) {
                if (this.isActive(stack)) {
                    result += text.substring(index);
                }
                break;
            }

            if (this.isActive(stack)) {
                result += text.substring(index, start);
            }

            const end = text.indexOf('}', start + 2);
            if (end === -1) {
                if (this.isActive(stack)) {
                    result += text.substring(start);
                }
                break;
            }

            const content = text.substring(start + 2, end);
            const handled = this.handleCommand(content, stack, warnings);

            if (!handled && this.isActive(stack)) {
                result += text.substring(start, end + 1);
            }

            // Move index past the closing brace
            index = end + 1;
            
            // If this was a define command and there's a newline right after it, skip it
            // to prevent leading empty lines in the result
            if (handled && content.startsWith('define') && index < text.length && text[index] === '\n') {
                index++;
            }
        }

        if (stack.length > 0) {
            warnings.push('Unclosed conditional block.');
        }

        return { result, warnings };
    }

    /**
     * @description Handle a single preprocessor command from within a @{...} block.
     * @param {string} content - The command content (without @{ and }).
     * @param {ConditionFrame[]} stack - The current condition stack.
     * @param {string[]} warnings - Array to collect warning messages.
     * @returns {boolean} True if the command was recognized and handled, false otherwise.
     */
    private handleCommand(content: string, stack: ConditionFrame[], warnings: string[]): boolean {
        if (DEFINE_REGEX.test(content)) {
            const match = content.match(DEFINE_REGEX);
            if (!match) return true;
            if (this.isActive(stack)) {
                const name = match[1];
                const value = match[2];
                this.context.define(name, value);
            }
            return true;
        }

        if (IFDEF_REGEX.test(content)) {
            const match = content.match(IFDEF_REGEX);
            if (!match) return true;
            const name = match[1];
            const conditionMet = this.context.isDefined(name);
            this.pushFrame(stack, 'ifdef', conditionMet);
            return true;
        }

        if (IFNDEF_REGEX.test(content)) {
            const match = content.match(IFNDEF_REGEX);
            if (!match) return true;
            const name = match[1];
            const conditionMet = !this.context.isDefined(name);
            this.pushFrame(stack, 'ifndef', conditionMet);
            return true;
        }

        if (IF_REGEX.test(content)) {
            const match = content.match(IF_REGEX);
            if (!match) return true;
            const leftName = match[1];
            const test = match[2];
            const rightRaw = match[3];

            const leftValue = this.getMacroValue(leftName, warnings);
            const rightValue = this.getRightValue(rightRaw, warnings);

            const conditionMet = this.evaluateCondition(leftValue, test, rightValue, warnings);
            this.pushFrame(stack, 'if', conditionMet);
            return true;
        }

        if (ELSE_REGEX.test(content)) {
            if (stack.length === 0) {
                warnings.push('Unmatched else encountered.');
                return true;
            }

            const frame = stack[stack.length - 1];
            if (frame.hasElse) {
                warnings.push('Duplicate else encountered in the same conditional block.');
                return true;
            }

            frame.hasElse = true;
            const parentActive = stack.length > 1 ? stack[stack.length - 2].currentlyActive : true;
            frame.currentlyActive = parentActive && !frame.conditionMet;
            return true;
        }

        if (ENDIF_REGEX.test(content)) {
            if (stack.length === 0) {
                warnings.push('Unmatched endif encountered.');
                return true;
            }
            stack.pop();
            return true;
        }

        warnings.push(`Invalid command syntax: @{${content}}`);
        return false;
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
        const value = this.context.getValue(name);
        if (value === undefined) {
            warnings.push(`Macro ${name} is not defined.`);
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
