import * as vscode from 'vscode';
import { AgentMetadata, ContextItem } from '../types';
import { SkillManager, SkillMetadata } from '../contextManagement/skillManager';
import { ContextTreeItem, ContextItemData, ContextItemType, CategoryType } from './contextTreeItem';

/**
 * @description Context tree data provider, implements VSCode TreeDataProvider interface
 * Responsible for managing the hierarchical structure of context items (Rules, Skills, Macros, Files)
 * Data is obtained from the current notebook's metadata
 * @class ContextTreeDataProvider
 * @implements {vscode.TreeDataProvider<ContextTreeItem>}
 * @example
 * const provider = new ContextTreeDataProvider(extensionUri);
 * vscode.window.createTreeView('mutsumi.contextSidebar', { treeDataProvider: provider });
 */
export class ContextTreeDataProvider implements vscode.TreeDataProvider<ContextTreeItem> {
    /** @description Tree data change event emitter, used to trigger view refresh */
    private _onDidChangeTreeData = new vscode.EventEmitter<ContextTreeItem | undefined | null>();
    
    /** @description Tree data change event, VSCode subscribes to this event to update the view */
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** @description Current notebook document reference */
    private _currentNotebook?: vscode.NotebookDocument;

    /** @description All available rules from .mutsumi/rules directory */
    private _allRules: string[] = [];

    /** @description All available skills from SkillManager */
    private _allSkills: SkillMetadata[] = [];

    /** @description Extension URI for resolving paths */
    private _extensionUri: vscode.Uri;

    /**
     * @description Creates a new context tree data provider
     * @param {vscode.Uri} extensionUri - The extension's root URI
     */
    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        // Initial load of rules and skills
        this.refreshRules();
        this.refreshSkills();
    }

    /**
     * @description Gets the tree item of the specified element
     * @param {ContextTreeItem} element - The tree node to get
     * @returns {vscode.TreeItem} Corresponding VSCode tree item
     */
    getTreeItem(element: ContextTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * @description Gets the child nodes of the specified element
     * @param {ContextTreeItem} [element] - Parent node, returns root categories when not specified
     * @returns {Thenable<ContextTreeItem[]>} Promise of child node array
     * @example
     * const children = await provider.getChildren(categoryItem); // Get context items in a category
     * const roots = await provider.getChildren(); // Get category nodes (Rules, Skills, Macros, Files)
     */
    getChildren(element?: ContextTreeItem): Thenable<ContextTreeItem[]> {
        if (!element) {
            // Root level - return category nodes
            return Promise.resolve(this._buildCategoryNodes());
        }

        // If element is a category node, return its children
        if (element.data.type === 'category') {
            return Promise.resolve(element.children);
        }

        // Leaf nodes have no children
        return Promise.resolve([]);
    }

    /**
     * @description Sets the current notebook and triggers a refresh
     * @param {vscode.NotebookDocument} [notebook] - The notebook document to set as current
     */
    setCurrentNotebook(notebook?: vscode.NotebookDocument): void {
        this._currentNotebook = notebook;
        this.refresh();
    }

    /**
     * @description Triggers a refresh of the tree view
     * Fires the onDidChangeTreeData event to notify VSCode to update the view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }

    /**
     * @description Refreshes the list of available rules from the workspace
     * Reads all .md files from .mutsumi/rules directory and updates _allRules
     * @returns {Promise<void>}
     */
    async refreshRules(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                this._allRules = [];
                return;
            }

            this._allRules = await getAvailableRules(workspaceFolder);
        } catch (error) {
            console.error('Failed to refresh rules:', error);
            this._allRules = [];
        }
    }

    /**
     * @description Refreshes the list of available skills from SkillManager
     * @returns {Promise<void>}
     */
    async refreshSkills(): Promise<void> {
        try {
            const skillManager = SkillManager.getInstance();
            await skillManager.refresh();
            this._allSkills = [...skillManager.skillsList];
        } catch (error) {
            console.error('Failed to refresh skills:', error);
            this._allSkills = [];
        }
    }

    /**
     * @description Refreshes all context data (rules and skills) and triggers tree view update
     * This is a full refresh that re-discovers all skills and rules from the filesystem
     * @returns {Promise<void>}
     */
    async refreshAll(): Promise<void> {
        await this.refreshRules();
        await this.refreshSkills();
        this.refresh();
    }

    /**
     * @description Builds the category nodes (Rules, Skills, Macros, Files)
     * @private
     * @returns {ContextTreeItem[]} Array of category tree items
     */
    private _buildCategoryNodes(): ContextTreeItem[] {
        const { rules, skills, macros, files } = this._buildContextItems();

        const categories: ContextTreeItem[] = [];

        // Rules category
        const rulesData: ContextItemData = {
            type: 'category',
            key: 'RULES',
            category: 'rules'
        };
        const rulesNode = new ContextTreeItem(
            rulesData,
            rules.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        rulesNode.children = rules;
        categories.push(rulesNode);

        // Skills category
        const skillsData: ContextItemData = {
            type: 'category',
            key: 'SKILLS',
            category: 'skills'
        };
        const skillsNode = new ContextTreeItem(
            skillsData,
            skills.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        skillsNode.children = skills;
        categories.push(skillsNode);

        // Macros category
        const macrosData: ContextItemData = {
            type: 'category',
            key: 'MACROS',
            category: 'macros'
        };
        const macrosNode = new ContextTreeItem(
            macrosData,
            macros.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        macrosNode.children = macros;
        categories.push(macrosNode);

        // Files category
        const filesData: ContextItemData = {
            type: 'category',
            key: 'FILES',
            category: 'files'
        };
        const filesNode = new ContextTreeItem(
            filesData,
            files.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        filesNode.children = files;
        categories.push(filesNode);

        return categories;
    }

    /**
     * @description Builds context items from the current notebook's metadata
     * Reads activeRules, activeSkills, and contextItems from metadata and builds tree items
     * @private
     * @returns {Object} Object containing four arrays: rules, skills, macros, files
     */
    private _buildContextItems(): { rules: ContextTreeItem[]; skills: ContextTreeItem[]; macros: ContextTreeItem[]; files: ContextTreeItem[] } {
        const rules: ContextTreeItem[] = [];
        const skills: ContextTreeItem[] = [];
        const macros: ContextTreeItem[] = [];
        const files: ContextTreeItem[] = [];

        if (!this._currentNotebook) {
            return { rules, skills, macros, files };
        }

        // Get metadata from the notebook
        const metadata = this._currentNotebook.metadata as AgentMetadata | undefined;
        if (!metadata) {
            return { rules, skills, macros, files };
        }

        const activeRulesRaw = metadata.activeRules;
        const activeSkillsRaw = metadata.activeSkills;
        const contextItems = metadata.contextItems || [];

        // Build rule items - show all available rules with active state
        // If activeRules is undefined/null, all rules are active by default
        // If activeRules is an array (even empty), only those in the array are active
        const activeRules = activeRulesRaw || [];
        const activeRulesSet = new Set(activeRules);
        const defaultAllActive = activeRulesRaw === undefined || activeRulesRaw === null;
        
        for (const ruleName of this._allRules) {
            const isActive = defaultAllActive || activeRulesSet.has(ruleName);
            rules.push(new ContextTreeItem(
                {
                    type: 'rule',
                    key: ruleName.replace('.md', ''),
                    isActive
                },
                vscode.TreeItemCollapsibleState.None
            ));
        }

        // Build skill items - show all available skills with active state
        // If activeSkills is undefined/null, all skills are inactive by default (different from rules)
        const activeSkills = activeSkillsRaw || [];
        const activeSkillsSet = new Set(activeSkills);
        
        for (const skill of this._allSkills) {
            const isActive = activeSkillsSet.has(skill.name);
            skills.push(new ContextTreeItem(
                {
                    type: 'skill',
                    key: skill.name,
                    content: skill.description,
                    isActive
                },
                vscode.TreeItemCollapsibleState.None
            ));
        }

        // Build macro items from contextItems
        for (const contextItem of contextItems) {
            if (contextItem.type === 'macro') {
                macros.push(new ContextTreeItem(
                    {
                        type: 'macro',
                        key: contextItem.key,
                        content: contextItem.content
                    },
                    vscode.TreeItemCollapsibleState.None
                ));
            }
        }

        // Build file items from contextItems
        for (const contextItem of contextItems) {
            if (contextItem.type === 'file') {
                files.push(new ContextTreeItem(
                    {
                        type: 'file',
                        key: contextItem.key
                    },
                    vscode.TreeItemCollapsibleState.None
                ));
            }
        }

        return { rules, skills, macros, files };
    }
}

/**
 * @description Gets all available rules from the workspace's .mutsumi/rules directory
 * Reads all .md files and returns their names
 * @param {vscode.WorkspaceFolder} workspaceFolder - The workspace folder to read from
 * @returns {Promise<string[]>} Array of rule file names
 * @example
 * const rules = await getAvailableRules(workspaceFolder);
 * // Returns ['rule1.md', 'rule2.md', ...]
 */
export async function getAvailableRules(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
    const rules: string[] = [];
    
    try {
        const rulesUri = vscode.Uri.joinPath(workspaceFolder.uri, '.mutsumi', 'rules');
        
        // Check if the directory exists
        try {
            await vscode.workspace.fs.stat(rulesUri);
        } catch {
            // Directory doesn't exist
            return rules;
        }

        // Read directory contents
        const entries = await vscode.workspace.fs.readDirectory(rulesUri);
        
        // Filter for .md files
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                rules.push(name);
            }
        }

        // Sort alphabetically
        rules.sort();
    } catch (error) {
        console.error('Failed to get available rules:', error);
    }

    return rules;
}
