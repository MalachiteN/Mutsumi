import * as vscode from 'vscode';
import { ClearCacheButton } from './ClearCacheButton';
import { clearToolCache } from '../tools.d/toolManager';

/**
 * Registers the status bar items and their commands.
 */
export function registerStatusBarItems(context: vscode.ExtensionContext): void {
    const clearCacheButton = ClearCacheButton.getInstance();
    
    context.subscriptions.push(clearCacheButton);
    
    const clearCacheCommand = vscode.commands.registerCommand('mutsumi.clearToolCache', () => {
        clearToolCache();
        vscode.window.showInformationMessage('Tool result cache cleared.');
    });
    
    context.subscriptions.push(clearCacheCommand);
}
