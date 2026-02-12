import * as vscode from 'vscode';
import * as path from 'path';
import * as Diff from 'diff'; // Assuming 'diff' package is available
import { ToolContext, TerminationError } from './interface';
import { resolveUri, checkAccess, editFileSessionManager } from './utils';
import { DiffReviewAgent } from './edit_codelens_provider';
import { DiffCodeLensAction } from './edit_codelens_types';

// --- State Management ---

interface EditSession {
    id: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    originalUri: vscode.Uri;
    backupUri: vscode.Uri;  // Backup of original content (.temp-backup)
    editUri: vscode.Uri;     // User-editable temp file (.temp-edit)
    toolName: string;
    signalTermination?: () => void;
}

// Map<OriginalFilePath, Session>
const activeSessions = new Map<string, EditSession>();
let globalDiffAgent: DiffReviewAgent | undefined;

// --- Extension Activation ---

export function activateEditSupport(context: vscode.ExtensionContext) {
    // 1. Initialize DiffReviewAgent
    const diffReviewConfig = {
        actions: [],
        autoOpen: true
    };
    
    globalDiffAgent = new DiffReviewAgent(diffReviewConfig);
    globalDiffAgent.register(context);

    // 2. Register Commands

    // Command: Accept
    context.subscriptions.push(vscode.commands.registerCommand('diffReview.action.accept', async (filePath: string, _action: DiffCodeLensAction) => {
        const session = activeSessions.get(filePath);
        if (session) {
            try {
                // 1. Read User's Final Version (from the editable temp file)
                const userContentBytes = await vscode.workspace.fs.readFile(session.editUri);
                const userContent = new TextDecoder().decode(userContentBytes);

                // 2. Read Backup (original AI proposal)
                const backupContentBytes = await vscode.workspace.fs.readFile(session.backupUri);
                const backupContent = new TextDecoder().decode(backupContentBytes);

                // 3. Overwrite Original file with user's edited version
                await vscode.workspace.fs.writeFile(session.originalUri, userContentBytes);

                // 4. Generate Diff (User edits vs AI Proposal)
                const fileName = path.basename(filePath);
                const patch = Diff.createTwoFilesPatch(
                    `AI_Proposal/${fileName}`,
                    `User_Edited/${fileName}`,
                    backupContent,
                    userContent,
                    'AI Original',
                    'User Final'
                );

                // 5. Construct Feedback Message
                let feedbackMsg: string;
                if (patch.includes('@@')) {
                    feedbackMsg = [
                        "User accepted the changes with manual edits.",
                        "Below is the diff showing what the User changed ON TOP OF your generation:",
                        "",
                        patch,
                        "",
                        "Please analyze these manual edits to understand the User's intent."
                    ].join('\n');
                } else {
                    feedbackMsg = "User accepted the changes (no manual modifications made).";
                }

                // 6. Cleanup and Resolve
                cleanupSession(filePath, true);
                session.resolve(feedbackMsg);

                vscode.window.showInformationMessage('Changes applied successfully.');
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to apply edits: ${e.message}`);
            }
        }
    }));

    // Command: Reject
    context.subscriptions.push(vscode.commands.registerCommand('diffReview.action.reject', async (filePath: string, _action: DiffCodeLensAction) => {
        const session = activeSessions.get(filePath);
        if (session) {
            const toolName = session.toolName;
            
            // Show input box for rejection reason
            const reason = await vscode.window.showInputBox({
                placeHolder: 'Enter rejection reason (optional, press ESC to reject without reason)',
                prompt: 'Why are you rejecting these changes?'
            });
            
            if (reason === undefined || reason.trim() === '') {
                // User cancelled or entered empty reason - terminate the session
                session.signalTermination?.();
                cleanupSession(filePath, true);
                session.resolve(`[Rejected] The ${toolName} operation was rejected by user.`);
                vscode.window.showInformationMessage('Changes rejected.');
            } else {
                // User provided a reason - allow AI to continue with the feedback
                cleanupSession(filePath, true);
                session.resolve(`[Rejected with Reason] The ${toolName} operation was rejected by user. Reason: ${reason}`);
                vscode.window.showInformationMessage('Changes rejected with reason. Agent will continue generating.');
            }
        }
    }));

    // Command: Reopen Diff Editor from sidebar
    context.subscriptions.push(vscode.commands.registerCommand('mutsumi.reopenEditDiff', async (sessionId: string) => {
        // Find active session by sessionId
        let session: EditSession | undefined;
        let filePath: string | undefined;

        for (const [fp, s] of activeSessions.entries()) {
            if (s.id === sessionId) {
                session = s;
                filePath = fp;
                break;
            }
        }

        if (!session || !globalDiffAgent || !filePath) {
            vscode.window.showWarningMessage('Edit session not found or has already been resolved.');
            return;
        }

        try {
            // Reopen diff view between backup (left) and editable temp file (right)
            const actions: DiffCodeLensAction[] = [
                {
                    id: 'accept',
                    label: '$(check) Accept',
                    tooltip: 'Overwrite original file with changes',
                    handler: async () => {}
                },
                {
                    id: 'reject',
                    label: '$(x) Reject',
                    tooltip: 'Discard changes',
                    handler: async () => {}
                }
            ];

            await globalDiffAgent.compareWithTemp(filePath, session.editUri.fsPath, actions);
            vscode.window.showInformationMessage('Reopened diff editor for review.');
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to reopen editor: ${e.message}`);
        }
    }));
}

// --- Helper Functions ---

function cleanupSession(filePath: string, resolveManagerSession: boolean = true) {
    if (activeSessions.has(filePath) && globalDiffAgent) {
        // Clear CodeLens
        globalDiffAgent.codeLensProvider.clearActions(filePath);

        // Remove session
        const session = activeSessions.get(filePath);
        activeSessions.delete(filePath);

        // Mark session as resolved in the manager
        if (session && resolveManagerSession) {
            editFileSessionManager.resolveSession(session.id);
        }

        // Close the Diff Editor tab if it contains our temp file, then delete temp files
        if (session) {
            closeDiffEditorForTempFile(session.editUri).then(() => {
                // Delete both temp files after closing the tab
                vscode.workspace.fs.delete(session.editUri).then(undefined, () => {});
                vscode.workspace.fs.delete(session.backupUri).then(undefined, () => {});
            }).catch(() => {
                // If closing fails, still try to delete the temp files
                vscode.workspace.fs.delete(session.editUri).then(undefined, () => {});
                vscode.workspace.fs.delete(session.backupUri).then(undefined, () => {});
            });
        }
    }
}

/**
 * Find and close the Diff Editor tab that contains the specified temp file.
 * This specifically looks for tabs in diff view mode (vscode-diff:// scheme) 
 * where the modified side matches our temp file.
 */
async function closeDiffEditorForTempFile(tempUri: vscode.Uri): Promise<void> {
    const tempUriString = tempUri.toString();
    
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            // Check if this is an input with a modified field (diff editor)
            const input = tab.input as { 
                modified?: vscode.Uri; 
                original?: vscode.Uri;
                kind?: string;
            } | undefined;
            
            // Diff editor tabs have 'modified' property pointing to the right side
            if (input?.modified && input.modified.toString() === tempUriString) {
                // Close this specific tab
                await vscode.window.tabGroups.close(tab);
                return; // Found and closed, we're done
            }
        }
    }
}

// --- Main Tool Logic ---

export async function handleEdit(uriInput: string, newContent: string, context: ToolContext, toolName: string = 'edit_file'): Promise<string> {
    if (!globalDiffAgent) {
        throw new Error("Edit support not activated. Please ensure the extension is correctly initialized.");
    }

    const uri = resolveUri(uriInput);
    if (!checkAccess(uri, context.allowedUris)) {
        throw new Error(`Access Denied: Agent is not allowed to edit ${uri.toString()}`);
    }

    if (!context.notebook || !context.execution) {
        return "Error: Tool requires notebook context (interactive mode).";
    }

    const filePath = uri.fsPath;

    // Cancel existing session for this file if any
    if (activeSessions.has(filePath)) {
        const oldSession = activeSessions.get(filePath);
        if (oldSession) {
            editFileSessionManager.resolveSession(oldSession.id);
            oldSession.reject(new Error("New edit session started for this file, overriding previous request."));
        }
        cleanupSession(filePath, false); // Don't resolve again, we already did it above
    }

    return new Promise<string>(async (resolve, reject) => {
        // Construct Temp URIs in the same directory as the original file
        // This ensures relative path imports in the file are correctly resolved
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);
        const originalDir = path.dirname(filePath);
        
        // Create TWO temp files:
        // 1. Backup file (.temp-backup) - stores the original AI proposal
        const backupPath = path.join(originalDir, `.${basename}.temp-backup${ext}`);
        const backupUri = vscode.Uri.file(backupPath);
        
        // 2. Editable file (.temp-edit) - user edits this in diff editor
        const editPath = path.join(originalDir, `.${basename}.temp-edit${ext}`);
        const editUri = vscode.Uri.file(editPath);

        // Write AI proposal to BOTH files initially
        const encoder = new TextEncoder();
        const newContentBytes = encoder.encode(newContent);
        await vscode.workspace.fs.writeFile(backupUri, newContentBytes);
        await vscode.workspace.fs.writeFile(editUri, newContentBytes);

        // Register session with the manager first to get an ID
        const sessionId = editFileSessionManager.addSession({
            filePath,
            originalUri: uri,
            tempUri: editUri,  // Keep this for backward compatibility
            toolName: toolName
        });

        const session: EditSession = {
            id: sessionId,
            resolve,
            reject,
            originalUri: uri,
            backupUri: backupUri,
            editUri: editUri,
            toolName: toolName,
            signalTermination: context.signalTermination
        };

        // Define Actions (only Accept and Reject, no Partially Accept)
        const actions: DiffCodeLensAction[] = [
            {
                id: 'accept',
                label: '$(check) Accept',
                tooltip: 'Overwrite original file with changes',
                handler: async () => {} 
            },
            {
                id: 'reject',
                label: '$(x) Reject',
                tooltip: 'Discard changes',
                handler: async () => {} 
            }
        ];

        try {
            // Register session
            activeSessions.set(filePath, session);

            // Handle cancellation
            if (context.abortSignal) {
                context.abortSignal.addEventListener('abort', () => {
                    if (activeSessions.has(filePath)) {
                        cleanupSession(filePath, true);
                        // Resolve with a cancellation message so the conversation can continue
                        resolve(`[Tool Call Cancelled] The ${toolName} operation was cancelled by user or system.`);
                    }
                });
            }

            // Launch Diff View via Agent
            // Show: Original file (left) vs Editable temp file (right)
            await globalDiffAgent!.compareWithTemp(filePath, editUri.fsPath, actions);
            
        } catch (e) {
            // Mark session as resolved in case of error
            editFileSessionManager.resolveSession(sessionId);
            activeSessions.delete(filePath);
            // Clean up temp files
            vscode.workspace.fs.delete(backupUri).then(undefined, () => {});
            vscode.workspace.fs.delete(editUri).then(undefined, () => {});
            reject(e);
        }
    });
}
