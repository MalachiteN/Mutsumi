import * as vscode from 'vscode';
import * as path from 'path';
import * as Diff from 'diff';
import { v4 as uuidv4 } from 'uuid';
import { ToolContext, TerminationError } from './interface';
import { resolveUri, checkAccess } from './utils';
import { DiffReviewAgent } from './edit_codelens_provider';
import { DiffCodeLensAction } from './edit_codelens_types';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Public session interface for sidebar display
 */
export interface EditFileSession {
    id: string;
    filePath: string;
    originalUri: vscode.Uri;
    tempUri: vscode.Uri;
    toolName: string;
    timestamp: Date;
    status: 'pending' | 'partially_accepted' | 'resolved';
}

/**
 * Internal transaction state
 */
interface EditTransactionState {
    id: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    originalUri: vscode.Uri;
    backupUri: vscode.Uri;
    editUri: vscode.Uri;
    toolName: string;
    signalTermination?: () => void;
}

// ============================================================================
// TempFileHandler - Manages temporary file operations
// ============================================================================

class TempFileHandler {
    private readonly backupUri: vscode.Uri;
    private readonly editUri: vscode.Uri;

    constructor(originalUri: vscode.Uri) {
        const filePath = originalUri.fsPath;
        const ext = path.extname(filePath);
        const basename = path.basename(filePath, ext);
        const originalDir = path.dirname(filePath);

        const backupPath = path.join(originalDir, `.${basename}.temp-backup${ext}`);
        const editPath = path.join(originalDir, `.${basename}.temp-edit${ext}`);

        this.backupUri = vscode.Uri.file(backupPath);
        this.editUri = vscode.Uri.file(editPath);
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

    private async deleteSilently(uri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.delete(uri);
        } catch {
            // Silently ignore deletion errors
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
    async openDiff(originalFilePath: string, editUri: vscode.Uri, actions: DiffCodeLensAction[]): Promise<void> {
        if (!this.diffAgent) {
            throw new Error("DiffReviewAgent not initialized");
        }
        await this.diffAgent.compareWithTemp(originalFilePath, editUri.fsPath, actions);
    }

    /**
     * Clear CodeLens for a file
     */
    clearCodeLens(filePath: string): void {
        if (this.diffAgent) {
            this.diffAgent.codeLensProvider.clearActions(filePath);
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
// EditFileSessionManager - Sidebar UI state management (Legacy, kept for compatibility)
// ============================================================================

class EditFileSessionManager {
    private static instance: EditFileSessionManager;
    private sessions: Map<string, EditFileSession> = new Map();
    private _onDidChangeSessions = new vscode.EventEmitter<void>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private constructor() {}

    public static getInstance(): EditFileSessionManager {
        if (!EditFileSessionManager.instance) {
            EditFileSessionManager.instance = new EditFileSessionManager();
        }
        return EditFileSessionManager.instance;
    }

    public addSession(session: Omit<EditFileSession, 'id' | 'timestamp' | 'status'>, id?: string): string {
        const sessionId = id || uuidv4();
        const fullSession: EditFileSession = {
            ...session,
            id: sessionId,
            timestamp: new Date(),
            status: 'pending'
        };
        this.sessions.set(sessionId, fullSession);
        this._onDidChangeSessions.fire();
        return sessionId;
    }

    public markPartiallyAccepted(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.status = 'partially_accepted';
            this._onDidChangeSessions.fire();
        }
    }

    public resolveSession(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.status = 'resolved';
            setTimeout(() => {
                this.sessions.delete(id);
                this._onDidChangeSessions.fire();
            }, 1000);
        }
    }

    public getSession(id: string): EditFileSession | undefined {
        return this.sessions.get(id);
    }

    public getActiveSessions(): EditFileSession[] {
        return Array.from(this.sessions.values())
            .filter(s => s.status !== 'resolved')
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public getAllSessions(): EditFileSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public removeSession(id: string): void {
        this.sessions.delete(id);
        this._onDidChangeSessions.fire();
    }
}

export const editFileSessionManager = EditFileSessionManager.getInstance();

// ============================================================================
// EditTransaction - Represents a single edit transaction with its lifecycle
// ============================================================================

class EditTransaction {
    private readonly state: EditTransactionState;
    private readonly tempFileHandler: TempFileHandler;
    private readonly filePath: string;
    private resolved = false;

    constructor(
        filePath: string,
        originalUri: vscode.Uri,
        toolName: string,
        resolve: (value: string) => void,
        reject: (reason: any) => void,
        signalTermination?: () => void
    ) {
        this.filePath = filePath;
        this.tempFileHandler = new TempFileHandler(originalUri);

        this.state = {
            id: uuidv4(),
            resolve,
            reject,
            originalUri,
            backupUri: this.tempFileHandler.getBackupUri(),
            editUri: this.tempFileHandler.getEditUri(),
            toolName,
            signalTermination
        };
    }

    getId(): string {
        return this.state.id;
    }

    getFilePath(): string {
        return this.filePath;
    }

    getEditUri(): vscode.Uri {
        return this.state.editUri;
    }

    /**
     * Initialize temp files and register with session manager
     */
    async initialize(newContent: string): Promise<void> {
        await this.tempFileHandler.initialize(newContent);

        // Register with sidebar manager, using the transaction's id
        editFileSessionManager.addSession({
            filePath: this.filePath,
            originalUri: this.state.originalUri,
            tempUri: this.state.editUri,
            toolName: this.state.toolName
        }, this.state.id);
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

            // Generate diff
            const fileName = path.basename(this.filePath);
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
     * Handle reject action - discard changes
     */
    async handleReject(reason?: string): Promise<string> {
        if (this.resolved) {
            return "Transaction already resolved";
        }

        if (reason === undefined || reason.trim() === '') {
            // Throw TerminationError to stop the session, but mark as NOT a completed task
            // This distinguishes edit rejection from task_finish
            throw new TerminationError(
                `[Rejected] The ${this.state.toolName} operation was rejected by user.`,
                'edit_reject',
                false  // isTaskComplete = false - this is NOT a successful task completion
            );
        } else {
            return `[Rejected with Reason] The ${this.state.toolName} operation was rejected by user. Reason: ${reason}`;
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
    async cleanup(diffController: DiffEditorController, resolveManagerSession: boolean = true): Promise<void> {
        if (this.resolved) {
            return;
        }
        this.resolved = true;

        // Clear CodeLens
        diffController.clearCodeLens(this.filePath);

        // Mark session as resolved in sidebar
        if (resolveManagerSession) {
            editFileSessionManager.resolveSession(this.state.id);
        }

        // Close diff editor and clean up temp files
        try {
            await diffController.closeDiffEditor(this.state.editUri);
        } catch {
            // Ignore close errors
        }

        await this.tempFileHandler.cleanup();
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
    private transactions = new Map<string, EditTransaction>(); // Map<filePath, EditTransaction>
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
        // Command: Accept
        context.subscriptions.push(
            vscode.commands.registerCommand('diffReview.action.accept', async (filePath: string, _action: DiffCodeLensAction) => {
                const transaction = this.transactions.get(filePath);
                if (!transaction) {
                    return;
                }

                try {
                    const feedbackMsg = await transaction.accept();
                    // Resolve first, then cleanup (cleanup sets resolved flag which would block resolve)
                    transaction.resolve(feedbackMsg);
                    await transaction.cleanup(this.diffController, true);
                    this.transactions.delete(filePath);
                    vscode.window.showInformationMessage('Changes applied successfully.');
                } catch (e: any) {
                    vscode.window.showErrorMessage(e.message);
                }
            })
        );

        // Command: Reject
        context.subscriptions.push(
            vscode.commands.registerCommand('diffReview.action.reject', async (filePath: string, _action: DiffCodeLensAction) => {
                const transaction = this.transactions.get(filePath);
                if (!transaction) {
                    return;
                }

                const reason = await vscode.window.showInputBox({
                    placeHolder: 'Enter rejection reason (optional, press ESC to reject without reason)',
                    prompt: 'Why are you rejecting these changes?'
                });

                const feedbackMsg = await transaction.handleReject(reason);
                // Resolve first, then cleanup (cleanup sets resolved flag which would block resolve)
                transaction.resolve(feedbackMsg);
                await transaction.cleanup(this.diffController, true);
                this.transactions.delete(filePath);

                if (reason === undefined || reason.trim() === '') {
                    vscode.window.showInformationMessage('Changes rejected.');
                } else {
                    vscode.window.showInformationMessage('Changes rejected with reason. Agent will continue generating.');
                }
            })
        );

        // Command: Reopen Diff Editor from sidebar
        context.subscriptions.push(
            vscode.commands.registerCommand('mutsumi.reopenEditDiff', async (sessionId: string) => {
                let transaction: EditTransaction | undefined;
                let filePath: string | undefined;

                for (const [fp, tx] of this.transactions.entries()) {
                    if (tx.getId() === sessionId) {
                        transaction = tx;
                        filePath = fp;
                        break;
                    }
                }

                if (!transaction || !filePath) {
                    vscode.window.showWarningMessage('Edit session not found or has already been resolved.');
                    return;
                }

                try {
                    await this.diffController.openDiff(filePath, transaction.getEditUri(), transaction.getActions());
                    vscode.window.showInformationMessage('Reopened diff editor for review.');
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to reopen editor: ${e.message}`);
                }
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

        if (!context.notebook || !context.execution) {
            return "Error: Tool requires notebook context (interactive mode).";
        }

        const filePath = uri.fsPath;

        // Cancel existing session for this file if any
        await this.cancelExistingTransaction(filePath);

        return new Promise<string>(async (resolve, reject) => {
            const transaction = new EditTransaction(
                filePath,
                uri,
                toolName,
                resolve,
                reject,
                context.signalTermination
            );

            try {
                // Initialize temp files
                await transaction.initialize(newContent);

                // Register transaction
                this.transactions.set(filePath, transaction);

                // Handle cancellation
                if (context.abortSignal) {
                    context.abortSignal.addEventListener('abort', () => {
                        this.handleCancellation(filePath);
                    });
                }

                // Open diff editor
                await this.diffController.openDiff(filePath, transaction.getEditUri(), transaction.getActions());

            } catch (e) {
                // Cleanup on error
                editFileSessionManager.resolveSession(transaction.getId());
                this.transactions.delete(filePath);
                await transaction.cleanup(this.diffController, false);
                reject(e);
            }
        });
    }

    /**
     * Cancel existing transaction for a file
     */
    private async cancelExistingTransaction(filePath: string): Promise<void> {
        const existingTx = this.transactions.get(filePath);
        if (existingTx) {
            editFileSessionManager.resolveSession(existingTx.getId());
            existingTx.reject(new Error("New edit session started for this file, overriding previous request."));
            await existingTx.cleanup(this.diffController, false);
            this.transactions.delete(filePath);
        }
    }

    /**
     * Handle transaction cancellation
     */
    private async handleCancellation(filePath: string): Promise<void> {
        const transaction = this.transactions.get(filePath);
        if (transaction && !transaction.isResolved()) {
            const msg = transaction.cancel();
            // Resolve first, then cleanup (cleanup sets resolved flag which would block resolve)
            transaction.resolve(msg);
            await transaction.cleanup(this.diffController, true);
            this.transactions.delete(filePath);
        }
    }
}

// ============================================================================
// Legacy Exports - Compatibility Adapters
// ============================================================================

/**
 * @deprecated Use EditService.initialize() instead. Kept for backward compatibility.
 */
export function activateEditSupport(context: vscode.ExtensionContext): void {
    EditService.getInstance().initialize(context);
}

/**
 * Main entry point for edit_file tool - delegates to EditService
 */
export async function handleEdit(
    uriInput: string,
    newContent: string,
    context: ToolContext,
    toolName: string = 'edit_file'
): Promise<string> {
    return EditService.getInstance().requestEdit(uriInput, newContent, context, toolName);
}
