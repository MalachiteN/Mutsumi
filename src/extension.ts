import * as vscode from 'vscode';
import * as path from 'path';
import { MutsumiSerializer } from './notebook/serializer';
import { AgentController } from './controller';
import { AgentSidebarProvider } from './sidebar/agentSidebar';
import { AgentOrchestrator } from './agentOrchestrator';
import { activateEditSupport } from './tools.d/edit_file';
import { AgentTreeItem } from './sidebar/agentTreeItem';
import { ReferenceCompletionProvider } from './notebook/completionProvider';
import { CodebaseService } from './codebase/service';
import { initializeRules } from './contextManagement/prompts';
import { ImagePasteProvider } from './contextManagement/imagePasteProvider';
import { generateTitle, sanitizeFileName, ensureUniqueFileName } from './utils';
import { AgentMessage } from './types';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export function activate(context: vscode.ExtensionContext) {
    // 0. Initialize Codebase Service
    CodebaseService.getInstance().initialize(context).catch(console.error);

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

    // 4. Events Listeners for Agent Lifecycle
    // 监听打开
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(doc => {
            if (doc.notebookType === 'mutsumi-notebook') {
                const uuid = doc.metadata.uuid;
                const model = doc.metadata.model;
                if (uuid) {
                    AgentOrchestrator.getInstance().notifyNotebookOpened(uuid, doc.uri, {
                        ...doc.metadata,
                        model: model
                    });
                }
            }
        })
    );

    // 监听关闭
    context.subscriptions.push(
        vscode.workspace.onDidCloseNotebookDocument(doc => {
            if (doc.notebookType === 'mutsumi-notebook') {
                const uuid = doc.metadata.uuid;
                if (uuid) {
                    AgentOrchestrator.getInstance().notifyNotebookClosed(uuid);
                }
            }
        })
    );

    // 监听保存后自动重命名
    let isAutoRenaming = false;
    context.subscriptions.push(
        vscode.workspace.onDidSaveNotebookDocument(async doc => {
            if (isAutoRenaming) return;
            if (doc.notebookType !== 'mutsumi-notebook') return;
            if (doc.uri.scheme !== 'file') return;

            const name = doc.metadata?.name;
            if (typeof name !== 'string' || !name.trim()) return;

            const sanitizedName = sanitizeFileName(name);
            if (!sanitizedName) return;

            const currentBaseName = path.basename(
                doc.uri.fsPath,
                path.extname(doc.uri.fsPath)
            );

            if (sanitizedName === currentBaseName) return;

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
                await vscode.workspace.fs.rename(doc.uri, targetUri, { overwrite: false });
            } catch (error) {
                console.error('Failed to auto-rename notebook:', error);
            } finally {
                isAutoRenaming = false;
            }
        })
    );

    // 监听文件删除
    // 注意：onDidDeleteFiles 包含一个 fileDeleted 列表
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.mtm');
    context.subscriptions.push(watcher);
    context.subscriptions.push(
        watcher.onDidDelete((uri) => {
            AgentOrchestrator.getInstance().notifyFileDeleted(uri);
        })
    );

    // 注册自动补全
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'markdown', // 对应 Notebook Cell 的语言 ID
        new ReferenceCompletionProvider(),
        '@' // 触发字符
    );
    context.subscriptions.push(completionProvider);

    // 注册图片粘贴支持
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
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.newAgent', async () => {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                vscode.window.showErrorMessage('Please open a workspace folder first.');
                return;
            }
            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');
            try { await vscode.workspace.fs.createDirectory(agentDir); } catch {}

            await initializeRules(context.extensionUri, root);

            const name = `agent-${Date.now()}.mtm`;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);
            const initialContent = MutsumiSerializer.createDefaultContent([root.fsPath]);
            
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);
            await vscode.window.showNotebookDocument(
                await vscode.workspace.openNotebookDocument(newFileUri),
                { preview: false }
            );
        })
    );

    // 模型选择命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.selectModel', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            // 确保是 mutsumi-notebook 类型
            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }
            
            const config = vscode.workspace.getConfiguration('mutsumi');
            const modelsConfig = config.get<Record<string, string>>('models', {});
            const modelNames = Object.keys(modelsConfig);
            
            if (modelNames.length === 0) {
                vscode.window.showErrorMessage('No models configured in settings.');
                return;
            }
            
            const currentModel = editor.notebook.metadata?.model;

            // 创建带当前模型标记的选项，显示模型名和标签
            const items = modelNames.map(name => {
                const label = modelsConfig[name];
                const description = label ? `🏷️ ${label}` : undefined;
                const detail = name === currentModel ? '$(check) Current' : undefined;
                return {
                    label: name,
                    description,
                    detail,
                    picked: name === currentModel
                };
            });
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select model for this agent (current: ${currentModel || 'default'})`
            });
            
            if (selected) {
                // 更新 notebook metadata
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, model: selected.label };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
                
                vscode.window.showInformationMessage(`Model changed to: ${selected.label}`);
            }
        })
    );

    // 重新生成标题命令
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.regenerateTitle', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            // 确保是 mutsumi-notebook 类型
            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }

            // 1. 获取配置
            const config = vscode.workspace.getConfiguration('mutsumi');
            const apiKey = config.get<string>('apiKey');
            const baseUrl = config.get<string>('baseUrl');
            const titleModel = config.get<string>('titleGeneratorModel') || config.get<string>('defaultModel');

            if (!apiKey) {
                vscode.window.showErrorMessage('Please set mutsumi.apiKey in VSCode Settings.');
                return;
            }

            if (!titleModel) {
                vscode.window.showErrorMessage('Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel in VSCode Settings.');
                return;
            }

            // 2. 从 notebook 中提取所有消息（context）
            const messages: AgentMessage[] = [];
            for (const cell of editor.notebook.getCells()) {
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    // 用户消息
                    messages.push({ role: 'user', content: cell.document.getText() });
                    // 检查是否有交互记录
                    if (cell.metadata?.mutsumi_interaction) {
                        messages.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                    }
                }
            }

            if (messages.length === 0) {
                vscode.window.showWarningMessage('No conversation context found.');
                return;
            }

            // 3. 调用 generateTitle 生成标题
            try {
                const title = await generateTitle(messages, apiKey, baseUrl, titleModel);

                // 4. 更新 notebook metadata
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, name: title };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);

                vscode.window.showInformationMessage(`Title regenerated: ${title}`);
            } catch (error) {
                console.error('Failed to regenerate title:', error);
                vscode.window.showErrorMessage(`Failed to regenerate title: ${error}`);
            }
        })
    );

    // 打开文件
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
        }),
    );

    // 复制文件/区域引用到剪贴板
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.copyReference', async (uri?: vscode.Uri) => {
            // 如果是通过右键菜单触发，uri 参数会被传入
            // 如果是通过命令面板触发，需要获取当前活动的编辑器
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
                // 如果右键点击的是当前打开的文件，也尝试获取选区
                if (editor && editor.document.uri.toString() === targetUri.toString()) {
                    selection = editor.selection;
                }
            }

            if (!targetUri) return;

            // 计算相对路径
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
            let relativePath = targetUri.fsPath;
            if (workspaceFolder) {
                relativePath = path.relative(workspaceFolder.uri.fsPath, targetUri.fsPath).replace(/\\/g, '/');
            }

            let refString = '';

            if (selection && !selection.isEmpty && !selection.isSingleLine) {
                // 多行选中：@[path:start:end] (行号从1开始)
                const start = selection.start.line + 1;
                const end = selection.end.line + 1;
                refString = `@[${relativePath}:${start}:${end}]`;
            } else if (selection) {
                // 单行或光标位置：@[path:line]
                // 如果是光标位置，selection.start.line === selection.end.line
                const line = selection.active.line + 1;
                refString = `@[${relativePath}:${line}]`;
            } else {
                // 纯文件引用 (如在资源管理器右键)
                refString = `@[${relativePath}]`;
            }

            await vscode.env.clipboard.writeText(refString);
            vscode.window.setStatusBarMessage(`Copied reference: ${refString}`, 3000);
        })
    );

    activateEditSupport(context);
}

export function deactivate() {}
