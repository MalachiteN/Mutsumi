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
import { AgentTreeItem } from './sidebar/agentTreeItem';
import { ReferenceCompletionProvider } from './notebook/completionProvider';
import { CodebaseService } from './codebase/service';
import { initializeRules } from './contextManagement/prompts';
import { ImagePasteProvider } from './contextManagement/imagePasteProvider';
import { sanitizeFileName } from './utils';
import { registerToolbarCommands } from './notebook/toolbar';

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
    // Initialize Codebase Service
    CodebaseService.getInstance().initialize(context).catch(console.error);

    // 0. Initialize Agent Registry from disk
    // This is the first step to ensure registry is populated before any UI logic runs
    await AgentOrchestrator.getInstance().initialize();

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
            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');
            try { 
                await vscode.workspace.fs.createDirectory(agentDir); 
            } catch {
                // Directory may already exist
            }

            await initializeRules(context.extensionUri, root);

            // Get all existing rules to initialize the agent with all rules enabled
            let allRules: string[] = [];
            try {
                const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');
                const entries = await vscode.workspace.fs.readDirectory(rulesDir);
                allRules = entries
                    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                    .map(([name]) => name);
            } catch {
                // Ignore if rules dir doesn't exist yet
            }

            const name = `agent-${Date.now()}.mtm`;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);
            const initialContent = MutsumiSerializer.createDefaultContent([root.fsPath], allRules);
            
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);
            await vscode.window.showNotebookDocument(
                await vscode.workspace.openNotebookDocument(newFileUri),
                { preview: false }
            );
        })
    );

    // Open agent file command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.openAgentFile', async (item: AgentTreeItem) => {
            if (item && item.agentData && item.agentData.fileUri) {
                const uri = vscode.Uri.parse(item.agentData.fileUri);
                try {
                    const doc = await vscode.workspace.openNotebookDocument(uri);
                    await vscode.window.showNotebookDocument(doc, {
                        viewColumn: vscode.ViewColumn.Active,
                        preserveFocus: false,
                        preview: false
                    });
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to open agent file: ${e}`);
                }
            }
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
            let relativePath = targetUri.fsPath;
            if (workspaceFolder) {
                relativePath = path.relative(workspaceFolder.uri.fsPath, targetUri.fsPath).replace(/\\/g, '/');
            }

            let refString = '';

            if (selection && !selection.isEmpty && !selection.isSingleLine) {
                const start = selection.start.line + 1;
                const end = selection.end.line + 1;
                refString = `@[${relativePath}](${start}-${end})`;
            } else if (selection) {
                const line = selection.active.line + 1;
                refString = `@[${relativePath}](${line})`;
            } else {
                refString = `@[${relativePath}]`;
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
