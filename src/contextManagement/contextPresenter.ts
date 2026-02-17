import { ContextItem } from '../types';
import { getLanguageIdentifier } from '../utils';

/**
 * ContextPresenter - Responsible for formatting context items into Markdown
 * for the Ghost Block (<content_reference>) in the agent conversation.
 */
export class ContextPresenter {
    /**
     * Format context items into a Markdown string for the Ghost Block.
     * Overload 1: Accepts a single array of all context items
     * 
     * @param items - All context items (rules, files, tools)
     * @returns Formatted Markdown string containing the Ghost Block
     */
    static format(items: ContextItem[]): string;
    
    /**
     * Format context items and rules into a Markdown string for the Ghost Block.
     * Overload 2: Accepts separate arrays for rules and other items
     * 
     * @param rules - Rule context items to include
     * @param items - Other context items (files, tools) to include
     * @returns Formatted Markdown string containing the Ghost Block
     */
    static format(rules: ContextItem[], items: ContextItem[]): string;
    
    static format(arg1: ContextItem[], arg2?: ContextItem[]): string {
        let rules: ContextItem[] = [];
        let items: ContextItem[] = [];
        
        // Determine which overload was called
        if (arg2 === undefined) {
            // Single array overload: separate rules from other items
            rules = arg1.filter(item => item.type === 'rule');
            items = arg1.filter(item => item.type !== 'rule');
        } else {
            // Two arrays overload
            rules = arg1;
            items = arg2;
        }

        // Return empty string if no items to format
        if (rules.length === 0 && items.length === 0) {
            return '';
        }

        let contextMarkdown = '\n<content_reference>\n';

        // Add Rules
        if (rules.length > 0) {
            contextMarkdown += '\n以下是你必须遵守的规则：\n';
        }
        for (const rule of rules) {
            contextMarkdown += `\n# Rule: ${rule.key}\n\n${rule.content}\n`;
        }

        // Add Files
        const files = items.filter(i => i.type === 'file');
        if (files.length > 0) {
            contextMarkdown += '\n以下是用户使用@引用的文件（或其最新版本状态）：\n';
        }
        for (const file of files) {
            const versionStr = file.version ? ` (v${file.version})` : '';
            
            // Check if this is a reference to a previous version (content omitted)
            if (file.metadata?.isReference) {
                contextMarkdown += `\n# Source: ${file.key}${versionStr}\n> Content unchanged. See previous version ${versionStr}.\n`;
                continue;
            }

            const ext = file.key.split('.').pop() || '';
            const lang = getLanguageIdentifier(ext);
            contextMarkdown += `\n# Source: ${file.key}${versionStr}\n\n\`\`\`${lang}\n${file.content}\n\`\`\`\n`;
        }

        // Add Tools
        const tools = items.filter(i => i.type === 'tool');
        if (tools.length > 0) {
            contextMarkdown += '\n下面是用户使用@指定的工具调用，预执行结果如下：\n';
        }
        for (const tool of tools) {
            contextMarkdown += `\n# Tool Call: ${tool.key}\n> Args: ${JSON.stringify(tool.metadata)}\n\n${tool.content}\n`;
        }

        contextMarkdown += '\n上述规则展开、文件读取、工具调用均已预执行且保证结果最新。请直接使用其结果，无需重复\n</content_reference>';

        return contextMarkdown;
    }
}
