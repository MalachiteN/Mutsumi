import * as vscode from 'vscode';
import * as path from 'path';
import * as Diff from 'diff';
import { DiffCodeLensAction, DiffContext, DiffReviewConfig } from './edit_codelens_types';
import { getUriKey } from './utils';

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
    originalUri: vscode.Uri,
    tempEditUri: vscode.Uri,
    actions: DiffCodeLensAction[]
  ): Promise<void> {
    // 1. Register CodeLens actions for the temp file (diff editor right side)
    // Use temp file URI as key so CodeLens only shows on the right side
    this.codeLensProvider.registerActions(tempEditUri, actions, [], originalUri);

    // 2. Open Diff Editor
    await this.openDiffEditor(originalUri, tempEditUri);
  }

  private async openDiffEditor(originalUri: vscode.Uri, modifiedUri: vscode.Uri) {
    const originalName = path.posix.basename(originalUri.path);
    
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `Diff: ${originalName}`,
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
  // Map<UriKey, Actions[]>
  private actionMap = new Map<string, DiffCodeLensAction[]>();
  // Map<TempUriKey, OriginalUriKey>
  private tempFileToOriginalMap = new Map<string, string>(); 
  
  private onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onChangeEmitter.event;

  constructor(private config: DiffReviewConfig) {}

  registerActions(tempUri: vscode.Uri, actions: DiffCodeLensAction[], diffPositions?: number[], originalUri?: vscode.Uri): void {
    const tempKey = getUriKey(tempUri);
    this.actionMap.set(tempKey, actions);
    
    if (originalUri) {
      this.tempFileToOriginalMap.set(tempKey, getUriKey(originalUri));
    }
    this.onChangeEmitter.fire();
  }

  clearActions(uri: vscode.Uri): void {
    const key = getUriKey(uri);
    // Note: The actions are registered on the TEMP uri, but we might call clearActions with the ORIGINAL uri from the transaction.
    // However, the DiffEditorController.clearCodeLens is called with originalUri? 
    // Let's check EditTransaction.cleanup: it calls clearCodeLens(this.targetUri).
    // BUT actions are registered on tempEditUri.
    
    // So we need to find all temp URIs that map to this original URI and clear them.
    const keysToRemove: string[] = [];
    
    for (const [tempKey, origKey] of this.tempFileToOriginalMap.entries()) {
      if (origKey === key) {
        keysToRemove.push(tempKey);
      }
    }
    
    // Also remove if the key itself matches (in case we passed temp uri)
    if (this.actionMap.has(key)) {
        keysToRemove.push(key);
    }

    keysToRemove.forEach(k => {
        this.actionMap.delete(k);
        this.tempFileToOriginalMap.delete(k);
    });

    this.onChangeEmitter.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<any[]> {
    const docKey = getUriKey(document.uri);

    // Check if this document is an original file that has a corresponding temp file active
    // We don't want to show CodeLens on the left side of the diff (the original file)
    const isOriginalWithTempFile = Array.from(this.tempFileToOriginalMap.values()).includes(docKey);
    if (isOriginalWithTempFile) {
      return [];
    }

    // Look up actions
    let actions = this.actionMap.get(docKey);
    if (!actions) {
      return [];
    }

    // Determine the original URI for command arguments
    // If this is a temp file, use the mapped original URI; otherwise use document's URI
    // The command handler expects the URI of the file being edited (the "Subject" of the transaction)
    // In our transaction model, the subject is the ORIGINAL uri.
    const originalKey = this.tempFileToOriginalMap.get(docKey) || docKey;
    const originalUri = vscode.Uri.parse(originalKey); // This works because getUriKey uses toString()

    const codeLenses: vscode.CodeLens[] = [];
    if (actions.length === 0) {
      return codeLenses;
    }

    const range = new vscode.Range(0, 0, 0, 0);
    actions.forEach((action) => {
      const codeLens = new vscode.CodeLens(range);
      codeLens.command = {
        title: action.label,
        command: `diffReview.action.${action.id}`,
        tooltip: action.tooltip,
        // Pass originalUri to command so it can look up the transaction
        arguments: [originalUri, action]
      };
      codeLenses.push(codeLens);
    });

    return codeLenses;
  }
}
