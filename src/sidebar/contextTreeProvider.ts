import * as vscode from 'vscode';
import { AgentMetadata, ContextItem } from '../types';
import { SkillManager, SkillMetadata } from '../contextManagement/skillManager';
import { ContextTreeItem, ContextItemData, ContextItemType, CategoryType } from './contextTreeItem';
import { collectRulesRecursively } from '../contextManagement/prompts';

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

    /** @description All available rules from .mutsumi/rules directory (recursively collected with full paths) */
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

        // If element is a directory node, return its children
        if (element.data.type === 'directory') {
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
     * Recursively reads all .md files from .mutsumi/rules directory and subdirectories
     * @returns {Promise<void>}
     */
    async refreshRules(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                this._allRules = [];
                return;
            }

            this._allRules = await getAvailableRulesRecursive(workspaceFolder);
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
        const skills: ContextTreeItem[] = [];
        const macros: ContextTreeItem[] = [];
        const files: ContextTreeItem[] = [];

        if (!this._currentNotebook) {
            return { rules: this._buildRuleTree(), skills, macros, files };
        }

        // Get metadata from the notebook
        const metadata = this._currentNotebook.metadata as AgentMetadata | undefined;
        if (!metadata) {
            return { rules: this._buildRuleTree(), skills, macros, files };
        }

        const activeRulesRaw = metadata.activeRules;
        const activeSkillsRaw = metadata.activeSkills;
        const contextItems = metadata.contextItems || [];

        // Build hierarchical rule tree
        // If activeRules is undefined/null, all rules are active by default
        // If activeRules is an array (even empty), only those in the array are active
        const activeRules = activeRulesRaw || [];
        const activeRulesSet = new Set(activeRules);
        const defaultAllActive = activeRulesRaw === undefined || activeRulesRaw === null;

        // Build rule tree structure
        const rules = this._buildRuleTree(activeRulesSet, defaultAllActive);

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

    /**
     * @description Builds hierarchical tree structure from flat rule paths
     * @private
     * @param {Set<string>} activeRulesSet - Set of active rule paths
     * @param {boolean} defaultAllActive - Whether all rules are active by default
     * @returns {ContextTreeItem[]} Array of tree items (directories and files)
     */
    private _buildRuleTree(
        activeRulesSet: Set<string> = new Set(),
        defaultAllActive: boolean = true
    ): ContextTreeItem[] {
        // Group entries by directory
        const rootNodes: ContextTreeItem[] = [];
        const dirMap = new Map<string, ContextTreeItem[]>();

        // First pass: create all directory nodes and group file nodes
        for (const fullPath of this._allRules) {
            const isActive = defaultAllActive || activeRulesSet.has(fullPath);
            const lastSlashIndex = fullPath.lastIndexOf('/');
            const dirPath = lastSlashIndex > 0 ? fullPath.substring(0, lastSlashIndex) : '';
            const fileName = lastSlashIndex > 0 ? fullPath.substring(lastSlashIndex + 1) : fullPath;
            const nameWithoutExt = fileName.replace('.md', '');

            if (dirPath === '') {
                // Root level file
                rootNodes.push(new ContextTreeItem(
                    {
                        type: 'rule',
                        key: nameWithoutExt,
                        fullPath: fullPath,
                        isActive
                    },
                    vscode.TreeItemCollapsibleState.None
                ));
            } else {
                // File in subdirectory
                const fileNode = new ContextTreeItem(
                    {
                        type: 'rule',
                        key: nameWithoutExt,
                        fullPath: fullPath,
                        isActive
                    },
                    vscode.TreeItemCollapsibleState.None
                );

                // Get or create directory entry
                let dirChildren = dirMap.get(dirPath);
                if (!dirChildren) {
                    dirChildren = [];
                    dirMap.set(dirPath, dirChildren);
                }
                dirChildren.push(fileNode);
            }
        }

        // Second pass: create directory nodes and build hierarchy
        // Sort directory paths by depth (deepest first) to ensure children are created before parents
        const sortedDirPaths = Array.from(dirMap.keys()).sort((a, b) => {
            const depthA = a.split('/').length;
            const depthB = b.split('/').length;
            return depthB - depthA;
        });

        for (const dirPath of sortedDirPaths) {
            const children = dirMap.get(dirPath)!;
            const dirName = dirPath.split('/').pop() || dirPath;

            // Check if this directory has any active children
            const hasActiveChildren = children.some(child => child.data.isActive);

            const dirNode = new ContextTreeItem(
                {
                    type: 'directory',
                    key: dirName,
                    fullPath: dirPath,
                    isActive: hasActiveChildren
                },
                vscode.TreeItemCollapsibleState.Collapsed
            );
            dirNode.children = children;

            // Determine parent directory path
            const parentPath = dirPath.split('/').slice(0, -1).join('/');

            if (parentPath === '') {
                // This is a top-level directory
                rootNodes.push(dirNode);
            } else {
                // Add to parent directory
                const parentChildren = dirMap.get(parentPath);
                if (parentChildren) {
                    parentChildren.push(dirNode);
                } else {
                    // Parent directory doesn't exist yet, create it
                    dirMap.set(parentPath, [dirNode]);
                }
            }
        }

        // Sort root nodes: directories first, then files, both alphabetically
        rootNodes.sort((a, b) => {
            const aIsDir = a.data.type === 'directory';
            const bIsDir = b.data.type === 'directory';
            if (aIsDir && !bIsDir) return -1;
            if (!aIsDir && bIsDir) return 1;
            return a.data.key.localeCompare(b.data.key);
        });

        return rootNodes;
    }
}

/**
 * @description Gets all available rules from the workspace's .mutsumi/rules directory recursively
 * Reads all .md files from the directory and its subdirectories
 * @param {vscode.WorkspaceFolder} workspaceFolder - The workspace folder to read from
 * @returns {Promise<string[]>} Array of rule file paths (e.g., ['test.md', 'default/main.md'])
 */
export async function getAvailableRulesRecursive(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
    const rulesDir = vscode.Uri.joinPath(workspaceFolder.uri, '.mutsumi', 'rules');
    
    try {
        // Check if the directory exists
        try {
            await vscode.workspace.fs.stat(rulesDir);
        } catch {
            // Directory doesn't exist
            return [];
        }

        // Use collectRulesRecursively to get all markdown files
        const ruleFiles = await collectRulesRecursively(rulesDir, rulesDir);
        
        // Extract just the names (which are relative paths) and sort
        const paths = ruleFiles.map(({ name }) => name).sort();
        
        return paths;
    } catch (error) {
        console.error('Failed to get available rules:', error);
        return [];
    }
}