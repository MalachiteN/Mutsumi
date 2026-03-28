import * as vscode from 'vscode';
import { TemplateEngine } from '../contextManagement/templateEngine';
import { AgentMetadata } from '../types';
import { ContextTreeDataProvider } from './contextTreeProvider';

/**
 * @description Context item type definition
 * @typedef {('rule' | 'macro' | 'file' | 'category' | 'skill')} ContextItemType
 */
export type ContextItemType = 'rule' | 'macro' | 'file' | 'category' | 'skill' | 'directory';

/**
 * @description Category type definition for grouping context items
 * @typedef {('rules' | 'macros' | 'files' | 'skills')} CategoryType
 */
export type CategoryType = 'rules' | 'macros' | 'files' | 'skills';

/**
 * @description Context item data interface, defining the basic information of context tree items
 * @interface ContextItemData
 */
export interface ContextItemData {
    /** @description Type of the context item */
    type: ContextItemType;
    /** @description Unique key/identifier of the context item (display name) */
    key: string;
    /** @description Full path for rules/files in subdirectories (e.g., 'default/main.md', 'default/sub') */
    fullPath?: string;
    /** @description Content of the context item (for rules, macros, and files) */
    content?: string;
    /** @description Whether the rule/skill is active (only for rules and skills) */
    isActive?: boolean;
    /** @description Category type (only for category nodes) */
    category?: CategoryType;
}

/**
 * @description Context item tree node for displaying context items (rules, macros, files) in the sidebar
 * @class ContextTreeItem
 * @extends {vscode.TreeItem}
 * @example
 * const item = new ContextTreeItem(ruleData, vscode.TreeItemCollapsibleState.None);
 */
export class ContextTreeItem extends vscode.TreeItem {
    /** @description List of child context nodes */
    public children: ContextTreeItem[] = [];

    /**
     * @description Creates a new context tree node item
     * @param {ContextItemData} data - Context item data
     * @param {vscode.TreeItemCollapsibleState} collapsibleState - Collapsible state of the node
     */
    constructor(
        public readonly data: ContextItemData,
        collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(data.key, collapsibleState);

        this.iconPath = this.getIconPath();
        this.contextValue = this.getContextValue();

        // Set tooltip with content preview if available
        this.tooltip = this.buildTooltip();

        // For non-category types, set command to view the context item
        if (data.type !== 'category' && data.type !== 'directory') {
            this.command = {
                command: 'mutsumi.viewContextItem',
                title: 'View Context Item',
                arguments: [{ type: data.type, key: data.key, fullPath: data.fullPath, content: data.content }]
            };
        }
    }

    /**
     * @description Gets the corresponding icon based on context item type and state
     * @private
     * @returns {vscode.ThemeIcon} Corresponding theme icon
     */
    private getIconPath(): vscode.ThemeIcon {
        const { type, category, isActive } = this.data;

        if (type === 'category') {
            switch (category) {
                case 'rules':
                    return new vscode.ThemeIcon('book');
                case 'skills':
                    return new vscode.ThemeIcon('symbol-color');
                case 'macros':
                    return new vscode.ThemeIcon('symbol-field');
                case 'files':
                    return new vscode.ThemeIcon('files');
                default:
                    return new vscode.ThemeIcon('folder');
            }
        }

        if (type === 'rule') {
            return isActive
                ? new vscode.ThemeIcon('star-full')
                : new vscode.ThemeIcon('star-empty');
        }

        if (type === 'skill') {
            return isActive
                ? new vscode.ThemeIcon('star-full')
                : new vscode.ThemeIcon('star-empty');
        }

        if (type === 'macro') {
            return new vscode.ThemeIcon('symbol-field');
        }

        if (type === 'file') {
            return new vscode.ThemeIcon('file');
        }

        if (type === 'directory') {
            return new vscode.ThemeIcon('folder');
        }

        return new vscode.ThemeIcon('question');
    }

    /**
     * @description Gets the contextValue based on context item type and state
     * @private
     * @returns {string} Context value for menu contribution control
     */
    private getContextValue(): string {
        const { type, category, isActive } = this.data;

        if (type === 'category') {
            switch (category) {
                case 'rules':
                    return 'categoryRules';
                case 'skills':
                    return 'categorySkills';
                case 'macros':
                    return 'categoryMacros';
                case 'files':
                    return 'categoryFiles';
                default:
                    return 'category';
            }
        }

        if (type === 'rule') {
            return isActive ? 'ruleActive' : 'ruleInactive';
        }

        if (type === 'skill') {
            return isActive ? 'skillActive' : 'skillInactive';
        }

        if (type === 'macro') {
            return 'macro';
        }

        if (type === 'file') {
            return 'file';
        }

        if (type === 'directory') {
            return 'directory';
        }

        return 'contextItem';
    }

    /**
     * @description Builds tooltip displayed on mouse hover
     * @private
     * @returns {vscode.MarkdownString | string} Tooltip content
     */
    private buildTooltip(): vscode.MarkdownString | string {
        const { type, category, isActive, content } = this.data;

        if (type === 'category') {
            switch (category) {
                case 'rules':
                    return 'Rules: Active context rules for Agents';
                case 'skills':
                    return 'Skills: Active context skills for Agents';
                case 'macros':
                    return 'Macros: Reusable text snippets';
                case 'files':
                    return 'Files: Referenced context files';
                default:
                    return 'Category';
            }
        }

        const md = new vscode.MarkdownString();

        // Type label
        let typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        if ((type === 'rule' || type === 'skill') && isActive !== undefined) {
            typeLabel += isActive ? ' (Active)' : ' (Inactive)';
        }
        md.appendMarkdown(`**${typeLabel}**: \`${this.data.key}\`\n\n`);

        // Show full path if available (for rules in subdirectories)
        if (this.data.fullPath && this.data.fullPath !== this.data.key) {
            md.appendMarkdown(`*Path*: \`${this.data.fullPath}\`\n\n`);
        }

        // Content preview
        if (content) {
            const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
            md.appendMarkdown(`\`\`\`\n${preview}\n\`\`\``);
        }

        return md;
    }
}

/**
 * @description Registers context-related commands to VSCode
 * @param {vscode.ExtensionContext} context - Extension context for registering subscriptions
 * @param {ContextTreeDataProvider} contextTreeDataProvider - The context tree data provider for refreshing the view
 * @example
 * registerContextCommands(context, contextTreeDataProvider);
 */
export function registerContextCommands(
    context: vscode.ExtensionContext,
    contextTreeDataProvider: ContextTreeDataProvider
): void {
    // Register refresh context tree command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.refreshContextTree', async () => {
            await contextTreeDataProvider.refreshAll();
            vscode.window.showInformationMessage('Context tree refreshed');
        })
    );
    // Register view context item command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.viewContextItem', async (args: { type: string; key: string; content?: string }) => {
            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const notebook = notebookEditor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;
            if (!metadata) {
                return;
            }

            let displayContent = '';

            if (args.type === 'macro') {
                // Macros: show as @{define name, "value"} format
                displayContent = `@{define ${args.key}, "${args.content || ''}"}`;
            } else if (args.type === 'rule') {
                // Rules: read file and render with TemplateEngine
                // Use fullPath if available (for rules in subdirectories), otherwise use key
                try {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        // Determine the file path: use fullPath from args if available, otherwise construct from key
                        const ruleFileName = (args as any).fullPath || `${args.key}.md`;
                        const ruleUri = vscode.Uri.joinPath(workspaceFolder.uri, '.mutsumi', 'rules', ruleFileName);
                        const ruleContent = await vscode.workspace.fs.readFile(ruleUri);
                        const ruleText = new TextDecoder().decode(ruleContent);
                        
                        // Render with TemplateEngine using macro context
                        const macroContext: Record<string, string> = {};
                        for (const item of metadata.contextItems || []) {
                            if (item.type === 'macro') {
                                macroContext[item.key] = item.content;
                            }
                        }
                        const { renderedText } = await TemplateEngine.render(
                            ruleText,
                            macroContext,
                            workspaceFolder.uri,
                            metadata.allowed_uris || [workspaceFolder.uri.toString()],
                            'INLINE'
                        );
                        displayContent = renderedText;
                    }
                } catch (error) {
                    displayContent = `Error reading rule: ${error}`;
                }
            } else if (args.type === 'skill') {
                // Skills: read skill file and display as markdown (no TemplateEngine expansion)
                try {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        const skillUri = vscode.Uri.joinPath(workspaceFolder.uri, '.agents', 'skills', args.key, 'SKILL.md');
                        const skillContent = await vscode.workspace.fs.readFile(skillUri);
                        const skillText = new TextDecoder().decode(skillContent);
                        displayContent = skillText;
                    }
                } catch (error) {
                    // Try user home directory
                    try {
                        const os = require('os');
                        const homeDir = os.homedir();
                        const skillUri = vscode.Uri.file(require('path').join(homeDir, '.agents', 'skills', args.key, 'SKILL.md'));
                        const skillContent = await vscode.workspace.fs.readFile(skillUri);
                        const skillText = new TextDecoder().decode(skillContent);
                        displayContent = skillText;
                    } catch (innerError) {
                        displayContent = `Error reading skill: ${error}`;
                    }
                }
            } else if (args.type === 'file') {
                // Files: find in contextItems and render with TemplateEngine
                const contextItems = metadata.contextItems || [];
                const fileItem = contextItems.find(item => item.type === 'file' && item.key === args.key);
                if (fileItem && fileItem.content) {
                    // Render with TemplateEngine using macro context
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        const macroContext: Record<string, string> = {};
                        for (const item of metadata.contextItems || []) {
                            if (item.type === 'macro') {
                                macroContext[item.key] = item.content;
                            }
                        }
                        const { renderedText } = await TemplateEngine.render(
                            fileItem.content,
                            macroContext,
                            workspaceFolder.uri,
                            metadata.allowed_uris || [workspaceFolder.uri.toString()],
                            'INLINE'
                        );
                        displayContent = renderedText;
                    } else {
                        displayContent = fileItem.content;
                    }
                } else {
                    displayContent = `File not found: ${args.key}`;
                }
            }

            if (displayContent) {
                // Create a temporary document to show the content
                const doc = await vscode.workspace.openTextDocument({
                    language: 'markdown',
                    content: displayContent
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        })
    );

    // Register toggle rule command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleRule', async (item: ContextTreeItem) => {
            if (item.data.type !== 'rule' || !item.data.key) {
                return;
            }

            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const notebook = notebookEditor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;
            if (!metadata) {
                return;
            }

            const activeRules = metadata.activeRules || [];
            // Use fullPath if available (for rules in subdirectories), otherwise use key
            const ruleName = item.data.fullPath || `${item.data.key}.md`;
            const index = activeRules.indexOf(ruleName);

            if (index === -1) {
                // Add to active rules
                activeRules.push(ruleName);
                vscode.window.showInformationMessage(`Rule "${ruleName}" activated`);
            } else {
                // Remove from active rules
                activeRules.splice(index, 1);
                vscode.window.showInformationMessage(`Rule "${ruleName}" deactivated`);
            }

            // Update notebook metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...metadata, activeRules };
            edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
            await vscode.workspace.applyEdit(edit);

            // Refresh the tree view
            contextTreeDataProvider.refresh();
        })
    );

    // Register toggle skill command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleSkill', async (item: ContextTreeItem) => {
            if (item.data.type !== 'skill' || !item.data.key) {
                return;
            }

            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const notebook = notebookEditor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;
            if (!metadata) {
                return;
            }

            const activeSkills = metadata.activeSkills || [];
            const skillName = item.data.key;
            const index = activeSkills.indexOf(skillName);

            if (index === -1) {
                // Add to active skills
                activeSkills.push(skillName);
                vscode.window.showInformationMessage(`Skill "${item.data.key}" activated`);
            } else {
                // Remove from active skills
                activeSkills.splice(index, 1);
                vscode.window.showInformationMessage(`Skill "${item.data.key}" deactivated`);
            }

            // Update notebook metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...metadata, activeSkills };
            edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
            await vscode.workspace.applyEdit(edit);

            // Refresh the tree view
            contextTreeDataProvider.refresh();
        })
    );

    // Register remove macro command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.removeMacro', async (item: ContextTreeItem) => {
            if (item.data.type !== 'macro' || !item.data.key) {
                return;
            }

            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const notebook = notebookEditor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;
            if (!metadata || !metadata.contextItems) {
                return;
            }

            // Filter out the macro to be deleted
            const newContextItems = metadata.contextItems.filter(ci => !(ci.type === 'macro' && ci.key === item.data.key));

            // Update notebook metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...metadata, contextItems: newContextItems };
            edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
            await vscode.workspace.applyEdit(edit);

            // Refresh the tree view
            contextTreeDataProvider.refresh();
        })
    );

    // Register remove file command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.removeFile', async (item: ContextTreeItem) => {
            if (item.data.type !== 'file' || !item.data.key) {
                return;
            }

            const notebookEditor = vscode.window.activeNotebookEditor;
            if (!notebookEditor) {
                return;
            }

            const notebook = notebookEditor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;
            if (!metadata || !metadata.contextItems) {
                return;
            }

            const contextItems = metadata.contextItems.filter(ci => ci.key !== item.data.key);

            // Update notebook metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...metadata, contextItems };
            edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(newMetadata)]);
            await vscode.workspace.applyEdit(edit);

            // Refresh the tree view
            contextTreeDataProvider.refresh();
        })
    );
}
