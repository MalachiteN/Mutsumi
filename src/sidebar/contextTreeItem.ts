import * as vscode from 'vscode';
import { TemplateEngine } from '../contextManagement/templateEngine';
import { AgentMetadata } from '../types';
import { ContextTreeDataProvider, McpRegistryView } from './contextTreeProvider';
import { buildGhostStripEdits } from '../notebook/commands/utils';
import { t } from '../i18n';

/**
 * @description Context item type definition
 * @typedef {('rule' | 'macro' | 'file' | 'category' | 'skill' | 'directory' | 'agentType')} ContextItemType
 */
export type ContextItemType = 'rule' | 'macro' | 'file' | 'category' | 'skill' | 'directory' | 'agentType' | 'mcpServer' | 'mcpTool';

/**
 * @description Category type definition for grouping context items
 * @typedef {('rules' | 'macros' | 'files' | 'skills')} CategoryType
 */
export type CategoryType = 'rules' | 'macros' | 'files' | 'skills' | 'mcps';

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
    /** MCP server identity for server and tool nodes. */
    serverId?: string;
    /** MCP tool selection state. */
    enabled?: boolean;
    /** MCP runtime availability. */
    available?: boolean;
    /** MCP server runtime status. */
    mcpStatus?: 'connecting' | 'connected' | 'error' | 'notConfigured';
    /** Readable MCP server or tool error. */
    error?: string;
    /** Whether an MCP tool schema is valid for model exposure. */
    schemaValid?: boolean;
    /** Whether the node is informational because no Mutsumi notebook is active. */
    readOnly?: boolean;
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

        if (data.type === 'category' && data.category === 'mcps') {
            this.id = 'mcpCategory';
        } else if (data.type === 'mcpServer' && data.serverId) {
            this.id = `mcpServer:${data.serverId}`;
        } else if (data.type === 'mcpTool' && data.serverId) {
            this.id = `mcpTool:${data.serverId}:${data.key}`;
        }

        this.iconPath = this.getIconPath();
        this.contextValue = this.getContextValue();

        // Set tooltip with content preview if available
        this.tooltip = this.buildTooltip();

        // For non-category and non-agentType types, set command to view the context item
        if (data.type !== 'category' && data.type !== 'directory' && data.type !== 'agentType' && data.type !== 'mcpServer' && data.type !== 'mcpTool') {
            this.command = {
                command: 'mutsumi.viewContextItem',
                title: 'View Context Item',
                arguments: [{ type: data.type, key: data.key, fullPath: data.fullPath, content: data.content }]
            };
        }

        // Agent type node: show prefixed label and keep key as raw value
        if (data.type === 'agentType') {
            this.label = `${t('context.agentType.label')}: ${data.key}`;
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
                case 'mcps':
                    return new vscode.ThemeIcon('plug');
                default:
                    return new vscode.ThemeIcon('folder');
            }
        }

        if (type === 'agentType') {
            return new vscode.ThemeIcon('account');
        }

        if (type === 'mcpServer') {
            if (this.data.mcpStatus === 'error') return new vscode.ThemeIcon('error');
            if (this.data.mcpStatus === 'connecting') return new vscode.ThemeIcon('sync~spin');
            if (this.data.mcpStatus === 'notConfigured') return new vscode.ThemeIcon('circle-slash');
            return new vscode.ThemeIcon('plug');
        }

        if (type === 'mcpTool') {
            if (this.data.schemaValid === false) return new vscode.ThemeIcon('warning');
            return this.data.enabled ? new vscode.ThemeIcon('check') : new vscode.ThemeIcon('circle-outline');
        }

        if (type === 'rule' || type === 'skill') {
            return isActive ? new vscode.ThemeIcon('check') : new vscode.ThemeIcon('circle-outline');
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
                case 'mcps':
                    return 'categoryMcps';
                default:
                    return 'category';
            }
        }

        if (type === 'agentType') {
            return 'agentType';
        }

        if (type === 'mcpServer') {
            if (this.data.readOnly) return 'mcpServerReadOnly';
            return this.data.enabled ? 'mcpServerEnabled' : 'mcpServerDisabled';
        }

        if (type === 'mcpTool') {
            if (this.data.readOnly) return 'mcpToolReadOnly';
            if (!this.data.available && !this.data.enabled) return 'mcpToolUnavailable';
            return this.data.enabled ? 'mcpToolEnabled' : 'mcpToolDisabled';
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
                    return t('context.category.rules');
                case 'skills':
                    return t('context.category.skills');
                case 'macros':
                    return t('context.category.macros');
                case 'files':
                    return t('context.category.files');
                case 'mcps':
                    return t('context.category.mcps');
                default:
                    return t('context.category.default');
            }
        }

        if (type === 'agentType') {
            return t('context.agentType.tooltip', this.data.key);
        }

        if (type === 'mcpServer') {
            const detail = this.data.error ? `\n\n${this.data.error}` : '';
            const readOnly = this.data.readOnly ? `\n\n${t('mcp.noNotebook')}` : '';
            return `${t('mcp.serverTooltip', this.data.serverId ?? this.data.key, t(`mcp.status.${this.data.mcpStatus}`))}${detail}${readOnly}`;
        }
        if (type === 'mcpTool') {
            const state = !this.data.available
                ? t('mcp.toolUnavailableTooltip')
                : this.data.schemaValid === false
                    ? t('mcp.toolSchemaErrorTooltip', this.data.error ?? '')
                    : this.data.enabled ? t('mcp.toolEnabledTooltip') : t('mcp.toolDisabledTooltip');
            return this.data.readOnly ? `${state}\n\n${t('mcp.noNotebook')}` : state;
        }

        const md = new vscode.MarkdownString();

        // Type label
        let typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        if ((type === 'rule' || type === 'skill') && isActive !== undefined) {
            typeLabel += isActive ? t('context.active') : t('context.inactive');
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

async function updateMcpSelection(
    serverId: string,
    toolName: string | undefined,
    enable: boolean,
    provider: ContextTreeDataProvider,
    allToolNames?: readonly string[]
): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || !editor.notebook.uri.fsPath.endsWith('.mtm')) {
        vscode.window.showWarningMessage(t('mcp.noNotebook'));
        return;
    }
    type Selection = { serverId: string; toolNames: string[] };
    const metadata = editor.notebook.metadata as AgentMetadata & { enabledMcpTools?: Selection[] };
    const selectionMap = new Map<string, string[]>((metadata.enabledMcpTools ?? []).map(value => [value.serverId, [...new Set(value.toolNames)] as string[]]));
    const current = selectionMap.get(serverId) ?? [];
    const next = toolName
        ? (enable ? [...new Set([...current, toolName])] : current.filter(name => name !== toolName))
        : (enable ? [...new Set(allToolNames ?? [])] : []);
    if (next.length) selectionMap.set(serverId, next);
    else selectionMap.delete(serverId);
    const enabledMcpTools = [...selectionMap.entries()].map(([id, toolNames]) => ({ serverId: id, toolNames }));
    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({ ...metadata, enabledMcpTools })]);
    await vscode.workspace.applyEdit(edit);
    provider.refresh();
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
    contextTreeDataProvider: ContextTreeDataProvider,
    mcpRegistry?: McpRegistryView
): void {
    // Register refresh context tree command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.refreshContextTree', async () => {
            await contextTreeDataProvider.refreshAll();
            vscode.window.showInformationMessage(t('context.refreshed'));
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.refreshMcpServers', async () => {
            if (!mcpRegistry) return;
            try {
                await mcpRegistry.reload();
                contextTreeDataProvider.refresh();
                vscode.window.showInformationMessage(t('mcp.refreshed'));
            } catch (error) {
                vscode.window.showErrorMessage(t('mcp.refreshFailed', String(error)));
            }
        }),
        vscode.commands.registerCommand('mutsumi.toggleMcpTool', async (item: ContextTreeItem) => {
            if (item?.data.type !== 'mcpTool' || !item.data.serverId) return;
            if (!item.data.enabled && (!item.data.available || item.data.schemaValid === false)) {
                vscode.window.showWarningMessage(t('mcp.cannotEnableUnavailable', item.data.serverId));
                return;
            }
            await updateMcpSelection(item.data.serverId, item.data.key, !item.data.enabled, contextTreeDataProvider);
        }),
        vscode.commands.registerCommand('mutsumi.toggleMcpServer', async (item: ContextTreeItem) => {
            if (item?.data.type !== 'mcpServer' || !item.data.serverId) return;
            const serverId = item.data.serverId;
            const record = mcpRegistry?.getRecords().find(value => value.serverId === serverId);
            const metadata = vscode.window.activeNotebookEditor?.notebook.metadata as (AgentMetadata & { enabledMcpTools?: { serverId: string; toolNames: string[] }[] }) | undefined;
            const existing = metadata?.enabledMcpTools?.find(value => value.serverId === serverId);
            if (existing) {
                await updateMcpSelection(serverId, undefined, false, contextTreeDataProvider);
            } else if (record?.status === 'connected') {
                await updateMcpSelection(
                    serverId,
                    undefined,
                    true,
                    contextTreeDataProvider,
                    record.tools.filter(tool => tool.schemaValid !== false).map(tool => tool.name),
                );
            } else {
                vscode.window.showWarningMessage(t('mcp.cannotEnableUnavailable', serverId));
            }
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
                    displayContent = t('context.readError', String(error));
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
                        displayContent = t('context.readError', String(innerError));
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
                    displayContent = t('context.fileNotFound', args.key);
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
                vscode.window.showInformationMessage(t('context.ruleActivated', ruleName));
            } else {
                // Remove from active rules
                activeRules.splice(index, 1);
                vscode.window.showInformationMessage(t('context.ruleDeactivated', ruleName));
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
                vscode.window.showInformationMessage(t('context.skillActivated', item.data.key));
            } else {
                // Remove from active skills
                activeSkills.splice(index, 1);
                vscode.window.showInformationMessage(t('context.skillDeactivated', item.data.key));
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

            const key = item.data.key;

            // Drop version tracking (lastHash/version) so a future re-reference re-injects fully
            const contextItems = metadata.contextItems.filter(ci => !(ci.type === 'file' && ci.key === key));
            const newMetadata = { ...metadata, contextItems };

            // Retroactively strip every ghost entry with this key from ALL cells,
            // so the file no longer appears anywhere in the assembled context.
            // This genuinely shortens the context and invalidates the LLM prefix
            // cache from the earliest modified cell onward.
            const edits = buildGhostStripEdits(notebook, file => file.key === key);
            edits.unshift(vscode.NotebookEdit.updateNotebookMetadata(newMetadata));

            const edit = new vscode.WorkspaceEdit();
            edit.set(notebook.uri, edits);
            await vscode.workspace.applyEdit(edit);

            // Refresh the tree view
            contextTreeDataProvider.refresh();
        })
    );
}
