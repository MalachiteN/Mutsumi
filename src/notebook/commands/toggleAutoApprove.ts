/**
 * @fileoverview Toggle auto approve command for Mutsumi notebook.
 * @module notebook/commands/toggleAutoApprove
 */

import * as vscode from 'vscode';
import { toggleAutoApprove, isAutoApproveEnabled } from '../../tools.d/permission';
import { t } from '../../i18n';

/**
 * Register the toggle auto approve commands.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerToggleAutoApproveCommands(context: vscode.ExtensionContext): void {
    // Toggle auto approve command (OFF -> ON)
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApprove', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage(t('toggleAutoApprove.on'));
                } else {
                    vscode.window.showInformationMessage(t('toggleAutoApprove.off'));
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(t('toggleAutoApprove.failed', String(error)));
            }
        })
    );

    // Toggle auto approve command (ON -> OFF) - same command but different icon
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApproveOn', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage(t('toggleAutoApprove.on'));
                } else {
                    vscode.window.showInformationMessage(t('toggleAutoApprove.off'));
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(t('toggleAutoApprove.failed', String(error)));
            }
        })
    );

    // Set initial context for auto-approve state
    void vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', isAutoApproveEnabled());

    // Sync toolbar context when auto-approve config changes (cross-window update)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mutsumi.autoApproveEnabled')) {
                void vscode.commands.executeCommand(
                    'setContext',
                    'mutsumi:autoApproveEnabled',
                    isAutoApproveEnabled()
                );
            }
        })
    );
}
