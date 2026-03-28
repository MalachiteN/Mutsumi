/**
 * @fileoverview Main extension entry point for Mutsumi VSCode extension.
 * @module extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { MutsumiSerializer } from './notebook/serializer';
import { AgentController } from './controller';
import { AgentSidebarProvider } from './sidebar/agentSidebar';
import { AgentOrchestrator } from './agent/agentOrchestrator';
import { activateEditSupport } from './tools.d/edit_file';

import { ReferenceCompletionProvider } from './notebook/completionProvider';
import { CodebaseService } from './codebase/service';
import { RagService } from './codebase/rag/service';
import { initializeRules, collectRulesRecursively } from './contextManagement/prompts';
import { ImagePasteProvider } from './contextManagement/imagePasteProvider';
import { SkillManager } from './contextManagement/skillManager';
import { sanitizeFileName } from './utils';
import { registerToolbarCommands } from './notebook/toolbar';
import { HeadlessAdapter } from './adapters/headlessAdapter';
import { ToolRegistry } from './tools.d/toolManager';
import { HttpServer } from './httpServer';
import { debugLogger } from './debugLogger';
import { toolsLogger } from './tools.d/toolsLogger';
import { registerStatusBarItems } from './statusBar';

// Agent Type System imports
import { loadMutsumiConfig, configFileExists } from './config/loader';
import { DEFAULT_MUTSUMI_CONFIG } from './config/types';
import { ToolSetRegistry } from './registry/toolSetRegistry';
import { AgentTypeRegistry } from './registry/agentTypeRegistry';
import { resolveAgentDefaults, getEntryAgentTypes } from './config/resolver';

/**
 * Checks if a file exists at the given URI.
 * @param {vscode.Uri} uri - URI to check
 * @returns {Promise<boolean>} True if the file exists
 * @example
 * const exists = await fileExists(uri);
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Activates the Mutsumi extension.
 * @description Registers all extension components including notebook serializer,
 * sidebar provider, controller, event listeners, commands, and completion providers.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 * @example
 * export function activate(context: vscode.ExtensionContext) {
 *   // Extension activation logic
 * }
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize Debug Logger first so other modules can use it
    debugLogger.initialize(context);

    // Initialize Tools Logger for streaming tool output
    toolsLogger.initialize(context);

    // Initialize ToolRegistry (required for the new ToolSet architecture)
    ToolRegistry.initialize();

    // Initialize Agent Type System (Config + Registries)
    // 1. Load Mutsumi configuration (merges user config with defaults)
    const mutsumiConfig = await loadMutsumiConfig();
    debugLogger.log('[Extension] Mutsumi config loaded successfully');

    // 1.5. If no config file exists, write the default config to workspace
    // This completes the bootstrap loop by persisting the built-in defaults
    const hasConfigFile = await configFileExists();
    if (!hasConfigFile) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (workspaceRoot) {
            try {
                const mutsumiDir = vscode.Uri.joinPath(workspaceRoot.uri, '.mutsumi');
                await vscode.workspace.fs.createDirectory(mutsumiDir);
                
                const configUri = vscode.Uri.joinPath(mutsumiDir, 'config.json');
                const configContent = new TextEncoder().encode(
                    JSON.stringify(DEFAULT_MUTSUMI_CONFIG, null, 2)
                );
                await vscode.workspace.fs.writeFile(configUri, configContent);
                debugLogger.log('[Extension] Default config written to .mutsumi/config.json');
            } catch (err) {
                debugLogger.log(`[Extension] Failed to write default config: ${err}`);
            }
        }
    }

    // 2. Initialize ToolSetRegistry with configured tool sets
    const toolSetRegistry = ToolSetRegistry.getInstance();
    toolSetRegistry.initialize(mutsumiConfig.toolSets);
    debugLogger.log('[Extension] ToolSetRegistry initialized');

    // 3. Initialize AgentTypeRegistry with configured agent types
    const agentTypeRegistry = AgentTypeRegistry.getInstance();
    agentTypeRegistry.initialize(
        mutsumiConfig.agentTypes,
        Object.keys(mutsumiConfig.toolSets)
    );
    debugLogger.log('[Extension] AgentTypeRegistry initialized');

    // Initialize SkillManager
    const skillManager = SkillManager.getInstance();
    await skillManager.initialize(context);

    // Initialize Codebase Service
    CodebaseService.getInstance().initialize(context).catch(console.error);

    // Initialize RAG Service
    const ragService = await RagService.getInstance(context);
    context.subscriptions.push(ragService);

    // 只在 RAG 启用时执行索引更新和注册文件监听器
    if (ragService.isEmbeddingEnabled()) {
        // 1. 启动时对所有工作区执行增量更新
        for (const wf of vscode.workspace.workspaceFolders ?? []) {
            ragService.updateWorkspace(wf.uri).catch(err => {
                debugLogger.log(`[RAG] Failed to update workspace on startup: ${err}`);
            });
        }

        // 2. 文件保存时更新其所在代码库（防抖处理）
        const pendingUpdates = new Map<string, NodeJS.Timeout>();
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                const uri = doc.uri;
                // 忽略缓存目录
                if (uri.fsPath.includes('.mutsumi')) {
                    return;
                }
                const wsFolder = vscode.workspace.getWorkspaceFolder(uri);
                if (!wsFolder) { return; }

                const wsKey = wsFolder.uri.toString();
                // 清除之前的定时器
                const existing = pendingUpdates.get(wsKey);
                if (existing) { clearTimeout(existing); }
                // 500ms 防抖后执行更新
                const timer = setTimeout(() => {
                    pendingUpdates.delete(wsKey);
                    ragService.updateWorkspace(wsFolder.uri).catch(err => {
                        debugLogger.log(`[RAG] Failed to update workspace on save: ${err}`);
                    });
                }, 500);
                pendingUpdates.set(wsKey, timer);
            })
        );
    }

    // 0. Initialize Agent Registry from disk
    // This is the first step to ensure registry is populated before any UI logic runs
    await AgentOrchestrator.getInstance().initialize();

    // Initialize HeadlessAdapter and HttpServer
    const headlessAdapter = new HeadlessAdapter();
    const httpServer = new HttpServer(headlessAdapter, context.extensionUri);
    httpServer.start().catch(err => {
        debugLogger.log(`[Extension] Failed to start HTTP server: ${err}`);
    });
    context.subscriptions.push({
        dispose: () => {
            httpServer.stop();
            headlessAdapter.dispose();
        }
    });

    // 1. Notebook Serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'mutsumi-notebook',
            new MutsumiSerializer(),
            { transientOutputs: true }
        )
    );

    // 2. Sidebar
    const sidebarProvider = new AgentSidebarProvider(context.extensionUri);
    sidebarProvider.registerTreeView(context);
    AgentOrchestrator.getInstance().setSidebar(sidebarProvider);

    // 3. Controller
    const agentController = new AgentController();
    const controller = vscode.notebooks.createNotebookController(
        'mutsumi-agent',
        'mutsumi-notebook',
        'Mutsumi Agent'
    );
    controller.supportedLanguages = ['markdown'];
    controller.supportsExecutionOrder = true;
    controller.executeHandler = (cells, notebook, ctrl) => {
        agentController.execute(cells, notebook, ctrl);
    };
    context.subscriptions.push(controller);

    AgentOrchestrator.getInstance().registerController(agentController, controller);

    // 4. Event Listeners for Agent Lifecycle
    // Track window state using Tab events to support background tabs.
    // Use onDidChangeTabs to detect when tabs are opened or closed.
    const handleTabsChanged = () => {
        AgentOrchestrator.getInstance().notifyTabsChanged();
    };

    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(handleTabsChanged),
        vscode.window.tabGroups.onDidChangeTabGroups(handleTabsChanged)
    );

    // Initial check for open tabs to handle startup state
    handleTabsChanged();
    
    // Also track when documents are opened (for initial load / New Agent command)
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(async doc => {
            if (doc.notebookType === 'mutsumi-notebook') {
                const uuid = doc.metadata.uuid;
                if (uuid) {
                    await AgentOrchestrator.getInstance().notifyNotebookDocumentOpened(uuid, doc.uri, {
                        ...doc.metadata
                    });
                }
            }
        })
    );

    // Auto-rename on save based on metadata name
    let isAutoRenaming = false;
    context.subscriptions.push(
        vscode.workspace.onDidSaveNotebookDocument(doc => {
            if (isAutoRenaming) {
                return;
            }
            if (doc.notebookType !== 'mutsumi-notebook') {
                return;
            }
            if (doc.uri.scheme !== 'file') {
                return;
            }

            const name = doc.metadata?.name;
            if (typeof name !== 'string' || !name.trim()) {
                return;
            }

            const sanitizedName = sanitizeFileName(name);
            if (!sanitizedName) {
                return;
            }

            const currentBaseName = path.basename(
                doc.uri.fsPath,
                path.extname(doc.uri.fsPath)
            );

            if (sanitizedName === currentBaseName) {
                return;
            }

            // Defer the rename operation to avoid conflicts with the ongoing save
            // VS Code will automatically update the editor to reflect the new file path
            setTimeout(async () => {
                try {
                    const dir = path.dirname(doc.uri.fsPath);
                    let suffix = 0;
                    let candidate = sanitizedName;
                    let targetUri = vscode.Uri.file(path.join(dir, `${candidate}.mtm`));

                    while (await fileExists(targetUri)) {
                        suffix += 1;
                        candidate = `${sanitizedName}-${suffix}`;
                        targetUri = vscode.Uri.file(path.join(dir, `${candidate}.mtm`));
                    }

                    isAutoRenaming = true;

                    const uuid = doc.metadata?.uuid;

                    // Perform the rename - VS Code will automatically update the editor
                    await vscode.workspace.fs.rename(doc.uri, targetUri, { overwrite: false });

                    // Update the agent registry with the new file URI
                    if (uuid) {
                        AgentOrchestrator.getInstance().updateAgentFileUri(uuid, targetUri);
                    }
                } catch (error) {
                    console.error('Failed to auto-rename notebook:', error);
                } finally {
                    isAutoRenaming = false;
                }
            }, 0);
        })
    );

    // File deletion watcher
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.mtm');
    context.subscriptions.push(watcher);
    context.subscriptions.push(
        watcher.onDidDelete(async (uri) => {
            await AgentOrchestrator.getInstance().notifyFileDeleted(uri);
        })
    );

    // Register completion provider for reference syntax
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'markdown',
        new ReferenceCompletionProvider(),
        '@'
    );
    context.subscriptions.push(completionProvider);

    // Register image paste support
    context.subscriptions.push(
        vscode.languages.registerDocumentPasteEditProvider(
            { language: 'markdown' },
            new ImagePasteProvider(),
            { 
                pasteMimeTypes: ['image/png', 'image/jpeg'],
                providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text]
            }
        )
    );

    // Register status bar items
    registerStatusBarItems(context);

    // 5. Commands
    registerCommands(context);

    activateEditSupport(context);
}

/**
 * Registers all extension commands.
 * @private
 * @param {vscode.ExtensionContext} context - Extension context
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // New Agent command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.newAgent', async () => {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                vscode.window.showErrorMessage('Please open a workspace folder first.');
                return;
            }

            // AgentType Step 1: Show QuickPick for Agent Type Selection
            const entryTypes = getEntryAgentTypes();

            if (entryTypes.length === 0) {
                vscode.window.showErrorMessage('No entry agent types available. Please check your configuration.');
                return;
            }

            // Build QuickPick items with descriptions
            const typeItems = entryTypes.map(({ name, config }) => ({
                label: name,
                description: `${config.toolSets.join('+')}`,
                detail: `Model: ${config.defaultModel} | Rules: ${config.defaultRules.length} | Skills: ${config.defaultSkills.length}`,
                typeName: name
            }));

            // Show QuickPick for agent type selection
            const selectedType = await vscode.window.showQuickPick(typeItems, {
                placeHolder: 'Select an agent type to create',
                title: 'Mutsumi: New Agent'
            });

            if (!selectedType) {
                // User cancelled
                return;
            }

            const selectedAgentType = selectedType.typeName;

            // AgentType Step 2: Create Agent with Selected Type Defaults
            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');
            try { 
                await vscode.workspace.fs.createDirectory(agentDir); 
            } catch {
                // Directory may already exist
            }

            await initializeRules(context.extensionUri, root);

            // Get all existing rules from the workspace (recursively)
            let allRules: string[] = [];
            try {
                const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');
                const ruleFiles = await collectRulesRecursively(rulesDir, rulesDir);
                allRules = ruleFiles.map(({ name }) => name);
            } catch {
                // Ignore if rules dir doesn't exist yet
            }

            // Resolve agent defaults using centralized resolver
            const defaults = resolveAgentDefaults(selectedAgentType, {
                availableRules: allRules
            });

            const name = `agent-${Date.now()}.mtm`;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);
            
            // Collect all workspace root URIs in standard format (e.g., file:///c:/...)
            const allWorkspaceUris = vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) || [root.toString()];

            // Create default content with agent type and its defaults
            const initialContent = MutsumiSerializer.createDefaultContent(
                allWorkspaceUris,
                selectedAgentType,
                defaults.rules,
                undefined, // Let it generate a new UUID
                defaults.skills
            );
            
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);
            await vscode.window.showNotebookDocument(
                await vscode.workspace.openNotebookDocument(newFileUri),
                { preview: false }
            );

            // Show confirmation message with agent type info
            vscode.window.showInformationMessage(
                `Created ${selectedAgentType} agent with ${defaults.rules.length} rules and ${defaults.skills.length} skills`
            );
        })
    );

    // Copy reference command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.copyReference', async (uri?: vscode.Uri) => {
            let targetUri = uri;
            let selection: vscode.Selection | undefined;
            let editor = vscode.window.activeTextEditor;

            if (!targetUri) {
                if (editor) {
                    targetUri = editor.document.uri;
                    selection = editor.selection;
                } else {
                    vscode.window.showErrorMessage('No file selected or active.');
                    return;
                }
            } else {
                if (editor && editor.document.uri.toString() === targetUri.toString()) {
                    selection = editor.selection;
                }
            }

            if (!targetUri) {
                return;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('File is not in the workspace.');
                return;
            }
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const isMultiRoot = workspaceFolders && workspaceFolders.length > 1;
            
            // Calculate relative path from the workspace folder
            const relativePath = path.relative(workspaceFolder.uri.fsPath, targetUri.fsPath).replace(/\\/g, '/');
            
            let refPath: string;
            if (isMultiRoot) {
                // In multi-root workspace, prefix with workspace folder name
                refPath = `${workspaceFolder.name}/${relativePath}`;
            } else {
                // In single-root workspace, use relative path only
                refPath = relativePath;
            }

            // Check if target is a directory, if so append trailing slash
            try {
                const stat = await vscode.workspace.fs.stat(targetUri);
                if (stat.type === vscode.FileType.Directory) {
                    refPath += '/';
                }
            } catch {
                // Ignore errors (e.g., file doesn't exist)
            }

            let refString = '';

            if (selection && !selection.isEmpty && !selection.isSingleLine) {
                const start = selection.start.line + 1;
                const end = selection.end.line + 1;
                refString = `@[${refPath}:${start}:${end}]`;
            } else if (selection) {
                const line = selection.active.line + 1;
                refString = `@[${refPath}:${line}]`;
            } else {
                refString = `@[${refPath}]`;
            }

            await vscode.env.clipboard.writeText(refString);
            vscode.window.setStatusBarMessage(`Copied reference: ${refString}`, 3000);
        })
    );

    // Register toolbar commands
    registerToolbarCommands(context);
}

/**
 * Deactivates the extension.
 * @description Cleanup function called when the extension is deactivated.
 */
export function deactivate(): void {}
