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
    tempUri: vscode.Uri;
    toolName: string;
    signalTermination?: () => void;
}

// Map<OriginalFilePath, Session>
const activeSessions = new Map<string, EditSession>();
let globalDiffAgent: DiffReviewAgent | undefined;
let globalTempDir: string | undefined;

// --- Extension Activation ---

export function activateEditSupport(context: vscode.ExtensionContext) {
    // 1. Initialize DiffReviewAgent
    globalTempDir = path.join(context.globalStorageUri.fsPath, 'temp_edits');
    
    const diffReviewConfig = {
        tempDirectory: globalTempDir,
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
                // Read from Temp file
                const newContentBytes = await vscode.workspace.fs.readFile(session.tempUri);
                // Overwrite Original file
                await vscode.workspace.fs.writeFile(session.originalUri, newContentBytes);

                // Cleanup and Resolve
                cleanupSession(filePath, true);
                session.resolve('User accepted the edit.');

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
            // Signal that the session should be terminated after this tool call
            session.signalTermination?.();
            cleanupSession(filePath, true);
            // Resolve with a rejection message that includes tool name, so the conversation can continue
            session.resolve(`[Tool Call Rejected] The ${toolName} operation was rejected by user.`);
            vscode.window.showInformationMessage('Changes rejected.');
        }
    }));

    // Command: Partially Accept (Apply changes -> Edit manually -> Continue)
    context.subscriptions.push(vscode.commands.registerCommand('diffReview.action.partiallyAccept', async (filePath: string, _action: DiffCodeLensAction) => {
        const session = activeSessions.get(filePath);
        if (session && globalDiffAgent) {
            try {
                // 1. Apply AI changes to the original file
                const newContentBytes = await vscode.workspace.fs.readFile(session.tempUri);
                await vscode.workspace.fs.writeFile(session.originalUri, newContentBytes);

                // 2. Mark session as partially accepted in the manager
                editFileSessionManager.markPartiallyAccepted(session.id);

                // 3. Define the "Continue" action
                const continueAction: DiffCodeLensAction = {
                    id: 'continueGenerate',
                    label: '$(sparkle) Continue Mutsumi Generate',
                    tooltip: 'Submit your manual adjustments and let AI continue',
                    handler: async () => {}
                };

                // 4. Switch View (Diff -> Standard Editor) and Update CodeLens
                // DO NOT resolve the session yet. The tool call remains pending.
                await globalDiffAgent.switchToStandardEditMode(filePath, [continueAction]);

                vscode.window.showInformationMessage('Changes applied. You can now edit the file. Click "Continue Mutsumi Generate" when done.');
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to proceed: ${e.message}`);
            }
        }
    }));

    // Command: Continue Mutsumi Generate (Finalize manual edits)
    context.subscriptions.push(vscode.commands.registerCommand('diffReview.action.continueGenerate', async (filePath: string, _action: DiffCodeLensAction) => {
        const session = activeSessions.get(filePath);
        if (session) {
            try {
                // 1. Read User's Final Version (from the actively edited file)
                const userDoc = await vscode.workspace.openTextDocument(session.originalUri);
                const userContent = userDoc.getText();

                // 2. Read AI's Original Proposal (from Temp file)
                const aiTempBytes = await vscode.workspace.fs.readFile(session.tempUri);
                const aiContent = new TextDecoder().decode(aiTempBytes);

                // 3. Generate Diff (User edits vs AI Proposal)
                const fileName = path.basename(filePath);
                const patch = Diff.createTwoFilesPatch(
                    `AI_Proposal/${fileName}`,
                    `User_Edited/${fileName}`,
                    aiContent,
                    userContent,
                    'AI Original',
                    'User Final'
                );

                // 4. Construct Feedback Prompt
                let feedbackMsg = "User accepted the changes.";
                if (patch.includes('@@')) {
                     feedbackMsg = [
                        "User partially accepted the changes and made manual edits.",
                        "Below is the diff showing what the User changed ON TOP OF your generation:",
                        "```diff",
                        patch,
                        "```",
                        "Please analyze these manual edits to understand the User's intent, and then continue generating the rest of the content."
                    ].join('\n');
                } else {
                    feedbackMsg = "User accepted the changes (no manual modifications made).";
                }

                // 5. Cleanup and Resolve
                cleanupSession(filePath, true);
                session.resolve(feedbackMsg);

            } catch (e: any) {
                vscode.window.showErrorMessage(`Error processing manual edits: ${e.message}`);
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
            const managerSession = editFileSessionManager.getSession(sessionId);

            if (managerSession?.status === 'partially_accepted') {
                // Partially accepted: open standard editor with Continue button
                const continueAction: DiffCodeLensAction = {
                    id: 'continueGenerate',
                    label: '$(sparkle) Continue Mutsumi Generate',
                    tooltip: 'Submit your manual adjustments and let AI continue',
                    handler: async () => {}
                };
                await globalDiffAgent.switchToStandardEditMode(filePath, [continueAction]);
                vscode.window.showInformationMessage('Reopened file editor. Click "Continue Mutsumi Generate" when done.');
            } else {
                // Pending: reopen diff view
                const tempContentBytes = await vscode.workspace.fs.readFile(session.tempUri);
                const tempContent = new TextDecoder().decode(tempContentBytes);

                const actions: DiffCodeLensAction[] = [
                    {
                        id: 'accept',
                        label: '$(check) Accept',
                        tooltip: 'Overwrite original file with changes',
                        handler: async () => {}
                    },
                    {
                        id: 'partiallyAccept',
                        label: '$(edit) Partially Accept',
                        tooltip: 'Apply changes, edit manually, then continue',
                        handler: async () => {}
                    },
                    {
                        id: 'reject',
                        label: '$(x) Reject',
                        tooltip: 'Discard changes',
                        handler: async () => {}
                    }
                ];

                await globalDiffAgent.compareWithTemp(filePath, tempContent, actions);
                vscode.window.showInformationMessage('Reopened diff editor for review.');
            }
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

        // Clean up temp file
        if (session) {
            vscode.workspace.fs.delete(session.tempUri).then(undefined, () => {});
        }
    }
}

// --- Main Tool Logic ---

export async function handleEdit(uriInput: string, newContent: string, context: ToolContext, toolName: string = 'edit_file'): Promise<string> {
    if (!globalDiffAgent || !globalTempDir) {
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
        // Construct Temp URI
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);
        const tempPath = path.join(globalTempDir!, `${basename}.new${ext}`);
        const tempUri = vscode.Uri.file(tempPath);

        // Register session with the manager first to get an ID
        const sessionId = editFileSessionManager.addSession({
            filePath,
            originalUri: uri,
            tempUri: tempUri,
            toolName: toolName
        });

        const session: EditSession = {
            id: sessionId,
            resolve,
            reject,
            originalUri: uri,
            tempUri: tempUri,
            toolName: toolName,
            signalTermination: context.signalTermination
        };

        // Define Actions
        const actions: DiffCodeLensAction[] = [
            {
                id: 'accept',
                label: '$(check) Accept',
                tooltip: 'Overwrite original file with changes',
                handler: async () => {} 
            },
            {
                id: 'partiallyAccept',
                label: '$(edit) Partially Accept',
                tooltip: 'Apply changes, edit manually, then continue',
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
            await globalDiffAgent!.compareWithTemp(filePath, newContent, actions);
            
        } catch (e) {
            // Mark session as resolved in case of error
            editFileSessionManager.resolveSession(sessionId);
            activeSessions.delete(filePath);
            reject(e);
        }
    });
}