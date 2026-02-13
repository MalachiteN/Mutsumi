/**
 * @fileoverview Utility functions for the Mutsumi VSCode extension.
 * @module utils
 */

/**
 * Sanitizes a string to be safe for use as a file name.
 * @description Removes or replaces characters that are invalid in file systems
 * and normalizes whitespace.
 * @param {string} name - Original name to sanitize
 * @returns {string} Sanitized name safe for file system use
 * @example
 * const safe = sanitizeFileName('file:name?test');
 * console.log(safe); // "file-name-test"
 */
export function sanitizeFileName(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Ensures a file name is unique by appending a numeric suffix if needed.
 * @description Checks against existing names and generates a unique variant
 * by adding "-1", "-2", etc. as needed.
 * @param {string} baseName - Base file name without extension
 * @param {string[]} existingNames - Array of existing file names to check against
 * @returns {string} Unique file name
 * @example
 * const unique = ensureUniqueFileName('agent', ['agent', 'agent-1']);
 * console.log(unique); // "agent-2"
 */
export function ensureUniqueFileName(baseName: string, existingNames: string[]): string {
    if (!existingNames.includes(baseName)) {
        return baseName;
    }
    
    let counter = 1;
    let newName = `${baseName}-${counter}`;
    
    while (existingNames.includes(newName)) {
        counter++;
        newName = `${baseName}-${counter}`;
    }
    
    return newName;
}

/**
 * Wraps multi-line HTML content in a themed container with rounded corners and semi-transparent background.
 * @description Creates a responsive container that appears light in dark themes and dark in light themes,
 * using CSS variables and backdrop-filter for adaptive styling.
 * The container width is determined by the longest line of content (inline-block behavior).
 * @param {string} content - The HTML/multi-line string content to wrap
 * @returns {string} Wrapped HTML string with themed container
 * @example
 * const wrapped = wrapInThemedContainer(`<p>Tool output here</p>`);
 * // Returns HTML with adaptive background styling
 */
export function wrapInThemedContainer(content: string): string {
    if (!content || content.trim().length === 0) {
        return '';
    }
    return `<div style="background-color: rgba(60, 60, 60, 1); padding: 12px 16px; border-radius: 8px; margin: 8px 0; display: block; width: fit-content; max-width: 90%;">${content}</div>`;
}
