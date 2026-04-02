import * as vscode from 'vscode';
import * as path from 'path';
import * as Diff from 'diff';
import { v4 as uuidv4 } from 'uuid';
import { ToolContext } from './interface';
import { resolveUri, checkAccess, getUriKey } from './utils';
import { DiffReviewAgent } from './edit_codelens_provider';
import { DiffCodeLensAction } from './edit_codelens_types';
import { approvalManager, isAutoApproveEnabled, isInRuleParsingMode, handleRejectionFlow } from './permission';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Internal transaction state
 */
interface EditTransactionState {
    id: string; // Internal Transaction ID
    approvalRequestId?: string; // Linked Approval Request ID
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    originalUri: vscode.Uri;
    backupUri: vscode.Uri;
    editUri: vscode.Uri;
    toolName: string;
    signalTermination?: (isTaskComplete?: boolean) => void;
    isNewFile?: boolean; // Whether the file is newly created
}

// ============================================================================
// TempFileHandler - Manages temporary file operations
// ============================================================================

class TempFileHandler {
    private readonly backupUri: vscode.Uri;
    private readonly editUri: vscode.Uri;

    constructor(originalUri: vscode.Uri) {
        // Use path.posix to manipulate URI paths which always use forward slashes
        const p = path.posix;
        const originalPath = originalUri.path;
        const ext = p.extname(originalPath);
        const basename = p.basename(originalPath, ext);
        
        // Construct temp file URIs in the same directory using URI logic
        // format: .<filename>.temp-backup<ext>
        const backupName = `.${basename}.temp-backup${ext}`;
        const editName = `.${basename}.temp-edit${ext}`;

        this.backupUri = vscode.Uri.joinPath(originalUri, '..', backupName);
        this.editUri = vscode.Uri.joinPath(originalUri, '..', editName);
    }

    getBackupUri(): vscode.Uri {
        return this.backupUri;
    }

    getEditUri(): vscode.Uri {
        return this.editUri;
    }

    /**
     * Initialize temp files with the same content
     */
    async initialize(content: string): Promise<void> {
        const encoder = new TextEncoder();
        const contentBytes = encoder.encode(content);
        await vscode.workspace.fs.writeFile(this.backupUri, contentBytes);
        await vscode.workspace.fs.writeFile(this.editUri, contentBytes);
    }

    /**
     * Read user-edited content from the editable temp file
     */
    async readUserContent(): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(this.editUri);
        return new TextDecoder().decode(bytes);
    }

    /**
     * Read backup content (original AI proposal)
     */
    async readBackupContent(): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(this.backupUri);
        return new TextDecoder().decode(bytes);
    }

    /**
     * Overwrite the original file with user content
     */
    async overwriteOriginal(originalUri: vscode.Uri, userContentBytes: Uint8Array): Promise<void> {
        await vscode.workspace.fs.writeFile(originalUri, userContentBytes);
    }

    /**
     * Clean up temp files silently (ignore errors)
     */
    async cleanup(): Promise<void> {
        await this.deleteSilently(this.editUri);
        await this.deleteSilently(this.backupUri);
    }

    /**
     * Ensure a file exists at the original URI.
     * Creates the file (and parent directories if needed) if it doesn't exist.
     * Returns true if a new file was created, false if file already exists.
     */
    async ensureFileExists(originalUri: vscode.Uri): Promise<boolean> {
        try {
            // Try to stat the file to check if it exists
            await vscode.workspace.fs.stat(originalUri);
            // File exists, do nothing
            return false;
        } catch {
            // File doesn't exist, ensure parent directory exists
            const parentUri = vscode.Uri.joinPath(originalUri, '..');
            await vscode.workspace.fs.createDirectory(parentUri);
            
            // Create empty file
            await vscode.workspace.fs.writeFile(originalUri, new Uint8Array(0));
            return true;
        }
    }

    private async deleteSilently(uri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.delete(uri);
        } catch {
            // Silently ignore deletion errors
        }
    }

    async deleteNewEmptyFileSilently(uri: vscode.Uri): Promise<void> {
        const stat = await vscode.workspace.fs.stat(uri);
        if(stat.size == 0){
            await this.deleteSilently(uri);
        }
    }
}

// ============================================================================
// DiffEditorController - Manages diff editor UI operations
// ============================================================================

class DiffEditorController {
    private diffAgent: DiffReviewAgent | undefined;

    initialize(context: vscode.ExtensionContext): void {
        const diffReviewConfig = {
            actions: [],
            autoOpen: true
        };

        this.diffAgent = new DiffReviewAgent(diffReviewConfig);
        this.diffAgent.register(context);
    }

    getDiffAgent(): DiffReviewAgent | undefined {
        return this.diffAgent;
    }

    /**
     * Open diff editor between original and temp file
     */
    async openDiff(originalUri: vscode.Uri, editUri: vscode.Uri, actions: DiffCodeLensAction[]): Promise<void> {
        if (!this.diffAgent) {
            throw new Error("DiffReviewAgent not initialized");
        }
        await this.diffAgent.compareWithTemp(originalUri, editUri, actions);
    }

    /**
     * Clear CodeLens for a file
     */
    clearCodeLens(uri: vscode.Uri): void {
        if (this.diffAgent) {
            this.diffAgent.codeLensProvider.clearActions(uri);
        }
    }

    /**
     * Close the diff editor tab containing the temp file
     */
    async closeDiffEditor(tempUri: vscode.Uri): Promise<void> {
        const tempUriString = tempUri.toString();

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input as {
                    modified?: vscode.Uri;
                    original?: vscode.Uri;
                    kind?: string;
                } | undefined;

                if (input?.modified && input.modified.toString() === tempUriString) {
                    await vscode.window.tabGroups.close(tab);
                    return;
                }
            }
        }
    }
}

// ============================================================================
// EditTransaction - Represents a single edit transaction with its lifecycle
// ============================================================================

class EditTransaction {
    public readonly state: EditTransactionState; // Changed to public to access approvalRequestId
    private readonly tempFileHandler: TempFileHandler;
    private readonly targetUri: vscode.Uri;
    private resolved = false;
    private readonly isNewFile: boolean;

    constructor(
        targetUri: vscode.Uri,
        toolName: string,
        resolve: (value: string) => void,
        reject: (reason: any) => void,
        isNewFile: boolean = false,
        signalTermination?: (isTaskComplete?: boolean) => void
    ) {
        this.targetUri = targetUri;
        this.isNewFile = isNewFile;
        this.tempFileHandler = new TempFileHandler(targetUri);

        this.state = {
            id: uuidv4(),
            resolve,
            reject,
            originalUri: targetUri,
            backupUri: this.tempFileHandler.getBackupUri(),
            editUri: this.tempFileHandler.getEditUri(),
            toolName,
            signalTermination,
            isNewFile
        };
    }

    getId(): string {
        return this.state.id;
    }

    getUri(): vscode.Uri {
        return this.targetUri;
    }

    getEditUri(): vscode.Uri {
        return this.state.editUri;
    }

    /**
     * Initialize temp files
     */
    async initialize(newContent: string): Promise<void> {
        await this.tempFileHandler.initialize(newContent);
    }

    /**
     * Handle accept action - apply user edits to original file
     */
    async accept(): Promise<string> {
        if (this.resolved) {
            return "Transaction already resolved";
        }

        try {
            const userContent = await this.tempFileHandler.readUserContent();
            const backupContent = await this.tempFileHandler.readBackupContent();
            const encoder = new TextEncoder();
            const userContentBytes = encoder.encode(userContent);

            // Overwrite original file
            await this.tempFileHandler.overwriteOriginal(this.state.originalUri, userContentBytes);

            // Generate diff for feedback
            const fileName = path.posix.basename(this.targetUri.path);
            const patch = Diff.createTwoFilesPatch(
                `AI_Proposal/${fileName}`,
                `User_Edited/${fileName}`,
                backupContent,
                userContent,
                'AI Original',
                'User Final'
            );

            // Construct feedback
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

            return feedbackMsg;
        } catch (e: any) {
            throw new Error(`Failed to apply edits: ${e.message}`);
        }
    }

    /**
     * Handle cancellation
     */
    cancel(): string {
        if (this.resolved) {
            return "Transaction already resolved";
        }
        return `[Tool Call Cancelled] The ${this.state.toolName} operation was cancelled by user or system.`;
    }

    /**
     * Clean up resources and mark as resolved
     */
    async cleanup(diffController: DiffEditorController): Promise<void> {
        if (this.resolved) {
            return;
        }
        this.resolved = true;

        // Clear CodeLens
        diffController.clearCodeLens(this.targetUri);

        // Close diff editor and clean up temp files
        try {
            await diffController.closeDiffEditor(this.state.editUri);
        } catch {
            // Ignore close errors
        }

        await this.tempFileHandler.cleanup();

        // If this was a new file and we're cleaning up (rejected), delete the original file
        if (this.isNewFile) {
            await this.tempFileHandler.deleteNewEmptyFileSilently(this.state.originalUri);
        }
    }

    /**
     * Get actions for CodeLens
     */
    getActions(): DiffCodeLensAction[] {
        return [
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
    }

    /**
     * Resolve the promise with a value
     */
    resolve(value: string): void {
        if (!this.resolved) {
            this.state.resolve(value);
        }
    }

    /**
     * Reject the promise with a reason
     */
    reject(reason: any): void {
        if (!this.resolved) {
            this.state.reject(reason);
        }
    }

    /**
     * Check if transaction is resolved
     */
    isResolved(): boolean {
        return this.resolved;
    }
}

// ============================================================================
// EditService - Core service managing all edit transactions
// ============================================================================

class EditService {
    private static instance: EditService;
    private transactions = new Map<string, EditTransaction>(); // Map<uriKey, EditTransaction>
    private diffController = new DiffEditorController();
    private initialized = false;

    private constructor() {}

    public static getInstance(): EditService {
        if (!EditService.instance) {
            EditService.instance = new EditService();
        }
        return EditService.instance;
    }

    /**
     * Initialize the service and register commands
     */
    initialize(context: vscode.ExtensionContext): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        this.diffController.initialize(context);
        this.registerCommands(context);
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        // Helper to find transaction from URI or string
        const getTransaction = (arg: string | vscode.Uri): EditTransaction | undefined => {
            if (arg instanceof vscode.Uri) {
                return this.transactions.get(getUriKey(arg));
            } else if (typeof arg === 'string') {
                try {
                     const uri = resolveUri(arg);
                     return this.transactions.get(getUriKey(uri));
                } catch {
                    return undefined;
                }
            }
            return undefined;
        };

        // Command: Accept (from CodeLens)
        context.subscriptions.push(
            vscode.commands.registerCommand('diffReview.action.accept', async (uriArg: vscode.Uri | string, _action: DiffCodeLensAction) => {
                const transaction = getTransaction(uriArg);
                if (transaction && transaction.state.approvalRequestId) {
                    await approvalManager.approveRequest(transaction.state.approvalRequestId);
                }
            })
        );

        // Command: Reject (from CodeLens)
        context.subscriptions.push(
            vscode.commands.registerCommand('diffReview.action.reject', async (uriArg: vscode.Uri | string, _action: DiffCodeLensAction) => {
                const transaction = getTransaction(uriArg);
                if (transaction && transaction.state.approvalRequestId) {
                    await approvalManager.rejectRequest(transaction.state.approvalRequestId);
                }
            })
        );
        
        // Command: Reopen Diff Editor (from Sidebar - now handled via approvalManager custom action, but kept for safety/logic reuse)
        context.subscriptions.push(
            vscode.commands.registerCommand('mutsumi.reopenEditDiff', async (sessionId: string) => {
                // sessionId here corresponds to the approval request ID usually if we map it?
                // Or we can find transaction by other means. 
                // In new architecture, permission module calls custom handler.
                // So this command might be redundant if the sidebar button calls mutsumi.customRequestAction.
                // But let's keep logic available.
                
                // Note: The sessionId passed here might be the Approval ID if we changed sidebar.
                // But we are removing EditFileSessionManager, so old sidebar items are gone.
                // The new sidebar uses ApprovalTreeItem which calls `mutsumi.customRequestAction`.
            })
        );
    }

    /**
     * Request a new edit operation
     */
    async requestEdit(
        uriInput: string,
        newContent: string,
        context: ToolContext,
        toolName: string = 'edit_file'
    ): Promise<string> {
        if (!this.diffController.getDiffAgent()) {
            throw new Error("Edit support not activated. Please ensure the extension is correctly initialized.");
        }

        const uri = resolveUri(uriInput);
        if (!checkAccess(uri, context.allowedUris)) {
            throw new Error(`Access Denied: Agent is not allowed to edit ${uri.toString()}`);
        }

        const uriKey = getUriKey(uri);

        // Cancel existing session for this file if any
        await this.cancelExistingTransaction(uriKey);

        // Check if file exists, create empty file if not
        const tempFileHandler = new TempFileHandler(uri);
        const isNewFile = await tempFileHandler.ensureFileExists(uri);

        return new Promise<string>(async (resolve, reject) => {
            const transaction = new EditTransaction(
                uri,
                toolName,
                resolve,
                reject,
                isNewFile,
                context.signalTermination
            );

            try {
                // Initialize temp files
                await transaction.initialize(newContent);

                // Register transaction
                this.transactions.set(uriKey, transaction);

                // Open diff editor
                await this.diffController.openDiff(uri, transaction.getEditUri(), transaction.getActions());

                // Determine auto-approve status
                const shouldAutoApprove = isAutoApproveEnabled() || isInRuleParsingMode();

                // Register with Permission Manager
                const requestId = approvalManager.createRequest(
                    `Edit File: ${path.basename(uri.path)}`,
                    uri.toString(),
                    {
                        onApprove: async () => {
                            try {
                                const feedbackMsg = await transaction.accept();
                                transaction.resolve(feedbackMsg);
                                await transaction.cleanup(this.diffController);
                                this.transactions.delete(uriKey);
                                vscode.window.showInformationMessage('Changes applied successfully.');
                            } catch (e: any) {
                                vscode.window.showErrorMessage(e.message);
                                throw e;
                            }
                        },
                        onReject: async () => {
                            const feedbackMsg = await handleRejectionFlow(
                                transaction.state.toolName,
                                transaction.state.signalTermination!
                            );
                            transaction.resolve(feedbackMsg);
                            await transaction.cleanup(this.diffController);
                            this.transactions.delete(uriKey);

                            vscode.window.showInformationMessage(
                                feedbackMsg.includes('Reason:')
                                    ? 'Changes rejected with reason.'
                                    : 'Changes rejected.'
                            );
                        },
                        customAction: {
                            label: 'Review Diff',
                            handler: async () => {
                                try {
                                    await this.diffController.openDiff(uri, transaction.getEditUri(), transaction.getActions());
                                    // Focus?
                                } catch (e: any) {
                                    vscode.window.showErrorMessage(`Failed to reopen editor: ${e.message}`);
                                }
                            }
                        }
                    },
                    "Review changes in Diff Editor. You can edit the right side (User Final) manually.",
                    shouldAutoApprove
                );
                
                transaction.state.approvalRequestId = requestId;

                // Handle cancellation (from LLM side / user aborting generation)
                if (context.abortSignal) {
                    context.abortSignal.addEventListener('abort', () => {
                        this.handleCancellation(uriKey, requestId);
                    });
                }

                // Show notification for quick access only if not auto-approved
                if (!shouldAutoApprove) {
                    vscode.window.showInformationMessage(
                        `Agent wants to edit ${path.basename(uri.path)}`,
                        'Show Diff'
                    ).then(selection => {
                        if (selection === 'Show Diff') {
                            approvalManager.handleCustomAction(requestId);
                        }
                    });
                } else {
                    const modeText = isInRuleParsingMode() ? ' (Rule Parsing)' : '';
                    vscode.window.showInformationMessage(
                        `⚡ Auto Approved Edit${modeText}: ${path.basename(uri.path)}`
                    );
                }

            } catch (e) {
                // Cleanup on error
                this.transactions.delete(uriKey);
                await transaction.cleanup(this.diffController);
                reject(e);
            }
        });
    }

    /**
     * Cancel existing transaction for a file
     */
    private async cancelExistingTransaction(uriKey: string): Promise<void> {
        const existingTx = this.transactions.get(uriKey);
        if (existingTx) {
            if (existingTx.state.approvalRequestId) {
                // Rejecting the permission request will trigger onReject which cleans up
                await approvalManager.rejectRequest(existingTx.state.approvalRequestId);
            } else {
                // Fallback cleanup if not registered
                existingTx.reject(new Error("New edit session started for this file, overriding previous request."));
                await existingTx.cleanup(this.diffController);
                this.transactions.delete(uriKey);
            }
        }
    }

    /**
     * Handle transaction cancellation
     */
    private async handleCancellation(uriKey: string, requestId: string): Promise<void> {
        const transaction = this.transactions.get(uriKey);
        if (transaction && !transaction.isResolved()) {
            // Rejecting via manager to ensure UI sync
             await approvalManager.rejectRequest(requestId);
             // Override resolve message if needed? 
             // onReject will set it to "rejected by user", but here it's cancellation.
             // But onReject logic is generic. 
             // Actually, if we want specific cancellation message, we might need to modify transaction state before rejecting,
             // or just let it be rejected.
        }
    }
}

// ============================================================================
// Legacy Exports - Compatibility Adapters
// ============================================================================

export function activateEditSupport(context: vscode.ExtensionContext): void {
    EditService.getInstance().initialize(context);
}

export async function handleEdit(
    uriInput: string,
    newContent: string,
    context: ToolContext,
    toolName: string = 'edit_file'
): Promise<string> {
    return EditService.getInstance().requestEdit(uriInput, newContent, context, toolName);
}
