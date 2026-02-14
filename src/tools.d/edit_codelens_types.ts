import * as vscode from 'vscode';

export interface DiffCodeLensAction {
  id: string;
  label: string;
  tooltip?: string;
  command?: string;
  // Handler logic is triggered by VSCode command
  handler: (filePath: string, diffContext?: DiffContext) => Promise<void>;
}

export interface DiffContext {
  originalUri: vscode.Uri;
  modifiedUri: vscode.Uri;
  tempUri: vscode.Uri;
  // content: ... (removed as we don't always load content in context)
}

export interface DiffReviewConfig {
  actions: DiffCodeLensAction[];
  autoOpen?: boolean;
}
