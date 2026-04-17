/**
 * @fileoverview Toolbar commands registration for Mutsumi notebook.
 * @module notebook/toolbar
 */

import * as vscode from 'vscode';
import {
    registerSelectModelCommand,
    registerRenameSessionCommand,
    registerDebugContextCommand,
    registerToggleAutoApproveCommands,
    registerTestRagSearchCommand,
    registerCompressConversationCommand
} from './commands';

/**
 * Registers all toolbar-related commands for Mutsumi notebooks.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerToolbarCommands(context: vscode.ExtensionContext): void {
    registerSelectModelCommand(context);
    registerRenameSessionCommand(context);
    registerDebugContextCommand(context);
    registerToggleAutoApproveCommands(context);
    registerTestRagSearchCommand(context);
    registerCompressConversationCommand(context);
}
