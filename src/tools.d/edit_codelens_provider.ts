import * as vscode from 'vscode';
import * as path from 'path';
import { DiffCodeLensAction, DiffContext, DiffReviewConfig } from './edit_codelens_types';

export class DiffReviewAgent {
  private config: DiffReviewConfig;
  public codeLensProvider: CustomCodeLensProvider;

  constructor(config: DiffReviewConfig) {
    this.config = config;
    this.codeLensProvider = new CustomCodeLensProvider(config);
  }

  public register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, this.codeLensProvider)
    );
  }

  // --- Diff Mode ---

  async compareWithTemp(
    originalFilePath: string,
    newContent: string,
    actions: DiffCodeLensAction[]
  ): Promise<void> {
    // 1. Write new content to Temp directory
    const ext = path.extname(originalFilePath);
    const basename = path.basename(originalFilePath, ext);
    const tempPath = path.join(this.config.tempDirectory, `${basename}.new${ext}`);
    
    const tempDir = vscode.Uri.file(this.config.tempDirectory);
    const tempFileUri = vscode.Uri.file(tempPath);

    // Ensure Temp directory exists
    try {
      await vscode.workspace.fs.stat(tempDir);
    } catch {
      await vscode.workspace.fs.createDirectory(tempDir);
    }

    // Write file
    const encoder = new TextEncoder();
    const fileData = encoder.encode(newContent);
    await vscode.workspace.fs.writeFile(tempFileUri, fileData);

    // 2. Register CodeLens actions for the original file
    this.codeLensProvider.registerActions(originalFilePath, actions);

    // 3. Open Diff Editor
    await this.openDiffEditor(originalFilePath, tempPath);
  }

  // --- Standard Edit Mode (New) ---

  async switchToStandardEditMode(
    filePath: string,
    actions: DiffCodeLensAction[]
  ): Promise<void> {
    // 1. Update CodeLens actions
    this.codeLensProvider.registerActions(filePath, actions);

    // 2. Open Standard Editor
    await this.openStandardEditor(filePath);
  }

  private async openDiffEditor(originalPath: string, modifiedPath: string) {
    const originalUri = vscode.Uri.file(originalPath);
    const modifiedUri = vscode.Uri.file(modifiedPath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `Diff: ${path.basename(originalPath)}`
    );

    this.ensureCodeLensEnabled();
  }

  private async openStandardEditor(filePath: string) {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    
    this.ensureCodeLensEnabled();
  }

  private async ensureCodeLensEnabled() {
    const config = vscode.workspace.getConfiguration('diffEditor');
    if (!config.get('codeLens')) {
      await config.update('codeLens', true, vscode.ConfigurationTarget.Global);
    }
  }
}

class CustomCodeLensProvider implements vscode.CodeLensProvider<any> {
  private actionMap = new Map<string, DiffCodeLensAction[]>();
  private onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChangeEmitter.event;

  constructor(private config: DiffReviewConfig) {}

  registerActions(filePath: string, actions: DiffCodeLensAction[]): void {
    this.actionMap.set(filePath, actions);
    this.onChangeEmitter.fire();
  }

  clearActions(filePath: string): void {
    this.actionMap.delete(filePath);
    this.onChangeEmitter.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<any[]> {
    const actions = this.actionMap.get(document.fileName) || [];
    const codeLenses: vscode.CodeLens[] = [];

    // Create a CodeLens for each registered action
    actions.forEach((action, index) => {
      // Place at the top of the file
      const range = new vscode.Range(0, 0, 0, 0); 
      const codeLens = new vscode.CodeLens(range);
      
      codeLens.command = {
        title: action.label,
        command: `diffReview.action.${action.id}`,
        tooltip: action.tooltip,
        arguments: [document.fileName, action]
      };

      codeLenses.push(codeLens);
    });

    return codeLenses;
  }
}