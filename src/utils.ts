/**
 * @fileoverview Utility functions for the Mutsumi VSCode extension.
 * @module utils
 */

import * as vscode from 'vscode';

/**
 * Default models configuration used when user hasn't configured any models.
 * @description These are the built-in default models that will be used
 * when the mutsumi.models setting is empty.
 */
const DEFAULT_MODELS: Record<string, string> = {
    "openai/gpt-4.1-nano": "质量极差，仅用于生成对话标题",
    "moonshotai/kimi-k2.5": "经济性好，适合普通编码任务，且经过为多Agent编排子任务的针对性后训练",
    "stepfun/step-3.5-flash": "有时有幻觉，只适合非重要任务，如执行简单具体的指令、修改简单的配置文件等",
    "google/gemini-3-pro-preview": "超贵，但智能极高、上下文窗口最大，适合无法分解、非常复杂的任务，或开始新项目前为整个项目设计长远架构和开发计划",
    "anthropic/claude-haiku-4.5": "略贵，适合阅读代码库、生成可信度高的模块概览或文档",
    "openai/gpt-5.2-codex": "比claude-haiku贵一点，但值得，用于复杂工程实现",
    "volcengine/doubao-seed-2.0-code": "价格实惠，用来写代码，能力约等于 claude-haiku"
};

/**
 * Gets the models configuration from VS Code settings.
 * @description Returns user-configured models if available, otherwise returns
 * the built-in default models. This allows users to override defaults by
 * configuring the mutsumi.models setting.
 * @returns {Record<string, string>} Models configuration (model name -> label)
 * @example
 * const models = getModelsConfig();
 * console.log(Object.keys(models)); // ['moonshotai/kimi-k2.5', ...]
 */
export function getModelsConfig(): Record<string, string> {
    const config = vscode.workspace.getConfiguration('mutsumi');
    const models = config.get<Record<string, string>>('models', {});
    
    // If user has configured models (non-empty object), use them
    if (Object.keys(models).length > 0) {
        return models;
    }
    
    // Otherwise return default models
    return DEFAULT_MODELS;
}

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
    return `<div style="background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.15)); padding: 12px 16px; border-radius: 8px; margin: 8px 0; display: block; width: fit-content; max-width: 90%;">${content}</div>`;
}

/**
 * Get language identifier for Markdown code block based on file extension
 */
export function getLanguageIdentifier(ext: string): string {
    const langMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'tsx',
        'js': 'javascript',
        'jsx': 'jsx',
        'py': 'python',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust',
        'java': 'java',
        'kt': 'kotlin',
        'swift': 'swift',
        'c': 'c',
        'cpp': 'cpp',
        'cc': 'cpp',
        'h': 'c',
        'hpp': 'cpp',
        'cs': 'csharp',
        'php': 'php',
        'html': 'html',
        'htm': 'html',
        'css': 'css',
        'scss': 'scss',
        'sass': 'sass',
        'less': 'less',
        'json': 'json',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml',
        'toml': 'toml',
        'md': 'markdown',
        'sh': 'bash',
        'bash': 'bash',
        'zsh': 'zsh',
        'fish': 'fish',
        'ps1': 'powershell',
        'sql': 'sql',
        'dockerfile': 'dockerfile',
        'makefile': 'makefile',
        'vue': 'vue',
        'svelte': 'svelte',
        'astro': 'astro'
    };
    return langMap[ext.toLowerCase()] || '';
}
