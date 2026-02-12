import * as vscode from 'vscode';
import * as path from 'path';
import * as Diff from 'diff';
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
    tempEditPath: string,
    actions: DiffCodeLensAction[]
  ): Promise<void> {
    // 1. Register CodeLens actions for the temp file (diff editor right side)
    // Use temp file path as key so CodeLens only shows on the right side
    this.codeLensProvider.registerActions(tempEditPath, actions, [], originalFilePath);

    // 2. Open Diff Editor
    await this.openDiffEditor(originalFilePath, tempEditPath);
  }

  private async openDiffEditor(originalPath: string, modifiedPath: string) {
    const originalUri = vscode.Uri.file(originalPath);
    const modifiedUri = vscode.Uri.file(modifiedPath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `Diff: ${path.basename(originalPath)}`,
      { preview: false }
    );

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
  private tempFileToOriginalMap = new Map<string, string>(); // Map temp file path to original file path
  private onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChangeEmitter.event;

  constructor(private config: DiffReviewConfig) {}

  registerActions(filePath: string, actions: DiffCodeLensAction[], diffPositions?: number[], originalFilePath?: string): void {
    this.actionMap.set(filePath, actions);
    // If original file path is provided, create mapping from temp file to original file
    // (for looking up session later)
    if (originalFilePath !== undefined) {
      this.tempFileToOriginalMap.set(filePath, originalFilePath);
    }
    this.onChangeEmitter.fire();
  }

  clearActions(filePath: string): void {
    this.actionMap.delete(filePath);
    // Also clean up any temp file mappings pointing to this file
    for (const [tempPath, origPath] of this.tempFileToOriginalMap.entries()) {
      if (origPath === filePath) {
        this.tempFileToOriginalMap.delete(tempPath);
      }
    }
    this.onChangeEmitter.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<any[]> {
    // Check if this is the original file that has a corresponding temp file
    // (i.e., it's the left side of a diff editor - don't show CodeLens there)
    const isOriginalWithTempFile = Array.from(this.tempFileToOriginalMap.values()).includes(document.fileName);
    if (isOriginalWithTempFile) {
      return [];
    }

    // Look up actions by document.fileName
    let actions = this.actionMap.get(document.fileName);
    
    if (!actions) {
      return [];
    }

    // Determine the original file path for command arguments
    // If this is a temp file, use the mapped original path; otherwise use document's path
    const originalFilePath = this.tempFileToOriginalMap.get(document.fileName) || document.fileName;
    const codeLenses: vscode.CodeLens[] = [];

    if (actions.length === 0) {
      return codeLenses;
    }

    // Place CodeLens at the top of the file
    const range = new vscode.Range(0, 0, 0, 0);
    actions.forEach((action) => {
      const codeLens = new vscode.CodeLens(range);
      codeLens.command = {
        title: action.label,
        command: `diffReview.action.${action.id}`,
        tooltip: action.tooltip,
        // Use originalFilePath for session lookup
        arguments: [originalFilePath, action]
      };
      codeLenses.push(codeLens);
    });

    return codeLenses;
  }
}
