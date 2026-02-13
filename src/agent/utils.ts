/**
 * @fileoverview Utility helper functions for the agent.
 * @module agent/utils
 */

/**
 * Tries to parse a potentially incomplete JSON string.
 * Uses a stack-based approach to properly close unterminated JSON structures.
 * @param {string} input - The raw JSON string
 * @returns {any} The parsed object or an empty object if parsing fails
 */
export function tryParsePartialJson(input: string): any {
    if (!input) return {};
    
    // First try to parse as-is
    try {
        return JSON.parse(input);
    } catch (e) {
        // If fails, try to close incomplete structures
        const closed = closeIncompleteJson(input);
        try {
            return JSON.parse(closed);
        } catch (e2) {
            // If all fails, return empty object so we can at least show the tool name
            return {};
        }
    }
}

/**
 * Uses a stack-based approach to properly close incomplete JSON structures.
 * Tracks braces, brackets, and string quotes to determine what needs to be closed.
 * @private
 * @param {string} input - Incomplete JSON string
 * @returns {string} JSON string with closing brackets/braces added
 */
function closeIncompleteJson(input: string): string {
    const stack: { char: string; inString: boolean }[] = [];
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            escapeNext = true;
            continue;
        }

        if (char === '"') {
            if (!inString) {
                // Entering a string, push a marker
                stack.push({ char: '"', inString: false });
                inString = true;
            } else {
                // Exiting a string, pop if the top is a string start
                const top = stack[stack.length - 1];
                if (top && top.char === '"') {
                    stack.pop();
                    inString = false;
                }
            }
            continue;
        }

        // Only process structural characters if not inside a string
        if (!inString) {
            if (char === '{' || char === '[') {
                stack.push({ char, inString: false });
            } else if (char === '}') {
                const top = stack[stack.length - 1];
                if (top && top.char === '{') {
                    stack.pop();
                }
            } else if (char === ']') {
                const top = stack[stack.length - 1];
                if (top && top.char === '[') {
                    stack.pop();
                }
            }
        }
    }

    // If we're still inside a string, we need to close it
    // But we can't safely do that without knowing the content
    // So we'll just add a closing quote and hope for the best
    let result = input;

    // Close structures in reverse order (LIFO)
    while (stack.length > 0) {
        const item = stack.pop()!;
        if (item.char === '"') {
            result += '"';
        } else if (item.char === '{') {
            result += '}';
        } else if (item.char === '[') {
            result += ']';
        }
    }

    return result;
}
