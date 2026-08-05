/**
 * @fileoverview One-click prune of all non-latest file references for Mutsumi notebook.
 * @module notebook/commands/pruneGhostBlocks
 */

import * as vscode from 'vscode';
import { AgentMetadata } from '../../types';
import { decodeGhostBlock } from '../../contextManagement/ghostBlocks';
import { buildGhostStripEdits } from './utils';
import { t } from '../../i18n';

/**
 * Register the prune ghost blocks command.
 * Strips every ghost file entry whose version is older than the latest known
 * version of that key, across all cells of the current notebook. Version
 * tracking in notebook metadata is preserved, so differential references to
 * the latest version keep working. The latest version is the max of the
 * tracked version (metadata.contextItems) and the versions actually present
 * in ghost blocks, which also covers orphan keys from legacy notebooks.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerPruneGhostBlocksCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.pruneGhostBlocks', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage(t('notebook.noEditor'));
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage(t('notebook.onlyMutsumi'));
                return;
            }

            const notebook = editor.notebook;
            const metadata = notebook.metadata as AgentMetadata | undefined;

            // Latest version per key: tracked version first...
            const latestVersions = new Map<string, number>();
            for (const item of metadata?.contextItems ?? []) {
                if (item.type === 'file') {
                    latestVersions.set(item.key, item.version || 1);
                }
            }
            // ...then raise to the max version actually present in ghost blocks
            for (let i = 0; i < notebook.cellCount; i++) {
                const block = decodeGhostBlock(notebook.cellAt(i).metadata?.last_ghost_block);
                if (!block) {
                    continue;
                }
                for (const file of block.files) {
                    latestVersions.set(file.key, Math.max(latestVersions.get(file.key) ?? 0, file.version));
                }
            }

            const edits = buildGhostStripEdits(
                notebook,
                file => file.version < (latestVersions.get(file.key) ?? file.version)
            );

            if (edits.length === 0) {
                vscode.window.showInformationMessage(t('pruneGhostBlocks.alreadyLatest'));
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            edit.set(notebook.uri, edits);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(t('pruneGhostBlocks.done', edits.length));
        })
    );
}
