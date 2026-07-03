import * as vscode from "vscode";
import * as path from "path";
import * as Diff from "diff";
import { v4 as uuidv4 } from "uuid";
import type { ToolContext } from "./interface";
import { resolveUri, checkAccess, getUriKey } from "./utils";
import {
	approvalManager,
	isAutoApproveEnabled,
	isInRuleParsingMode,
	handleRejectionFlow,
} from "./permission";
import { notifyApprovalNeeded } from "../notifications";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Internal transaction state
 */
interface EditTransactionState {
	id: string;
	approvalRequestId?: string;
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

/**
 * Ensure a file exists at the given URI.
 * Creates the file (and parent directories if needed) if it doesn't exist.
 * Returns true if a new file was created, false if file already exists.
 */
async function ensureFileExists(originalUri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(originalUri);
		return false;
	} catch {
		const parentUri = vscode.Uri.joinPath(originalUri, "..");
		await vscode.workspace.fs.createDirectory(parentUri);
		await vscode.workspace.fs.writeFile(originalUri, new Uint8Array(0));
		return true;
	}
}

class TempFileHandler {
	private readonly backupUri: vscode.Uri;
	private readonly editUri: vscode.Uri;

	constructor(originalUri: vscode.Uri, transactionId: string) {
		const p = path.posix;
		const originalPath = originalUri.path;
		const ext = p.extname(originalPath);
		const basename = p.basename(originalPath, ext);

		const shortId = transactionId.split("-")[0];

		const backupName = `.${basename}.${shortId}.temp-backup${ext}`;
		const editName = `.${basename}.${shortId}.temp-edit${ext}`;

		this.backupUri = vscode.Uri.joinPath(originalUri, "..", backupName);
		this.editUri = vscode.Uri.joinPath(originalUri, "..", editName);
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
	async overwriteOriginal(
		originalUri: vscode.Uri,
		userContentBytes: Uint8Array,
	): Promise<void> {
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

	async deleteNewEmptyFileSilently(uri: vscode.Uri): Promise<void> {
		const stat = await vscode.workspace.fs.stat(uri);
		if (stat.size == 0) {
			await this.deleteSilently(uri);
		}
	}
}

// ============================================================================
// DiffEditorController - Manages diff editor UI operations
// ============================================================================

class DiffEditorController {
	/**
	 * Open diff editor between original and temp file.
	 */
	async openDiff(originalUri: vscode.Uri, editUri: vscode.Uri): Promise<void> {
		const originalName = path.posix.basename(originalUri.path);
		await vscode.commands.executeCommand(
			"vscode.diff",
			originalUri,
			editUri,
			`Diff: ${originalName}`,
			{ preview: false },
		);
	}

	/**
	 * Close the diff editor tab containing the temp file.
	 */
	async closeDiffEditor(tempUri: vscode.Uri): Promise<void> {
		const tempUriString = tempUri.toString();

		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input as
					| {
							modified?: vscode.Uri;
							original?: vscode.Uri;
							kind?: string;
					  }
					| undefined;

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
	public readonly state: EditTransactionState;
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
		signalTermination?: (isTaskComplete?: boolean) => void,
	) {
		this.targetUri = targetUri;
		this.isNewFile = isNewFile;
		const id = uuidv4();
		this.tempFileHandler = new TempFileHandler(targetUri, id);

		this.state = {
			id,
			resolve,
			reject,
			originalUri: targetUri,
			backupUri: this.tempFileHandler.getBackupUri(),
			editUri: this.tempFileHandler.getEditUri(),
			toolName,
			signalTermination,
			isNewFile,
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
			await this.tempFileHandler.overwriteOriginal(
				this.state.originalUri,
				userContentBytes,
			);

			// Generate diff for feedback
			const fileName = path.posix.basename(this.targetUri.path);
			const patch = Diff.createTwoFilesPatch(
				`AI_Proposal/${fileName}`,
				`User_Edited/${fileName}`,
				backupContent,
				userContent,
				"AI Original",
				"User Final",
			);

			// Construct feedback
			let feedbackMsg: string;
			if (patch.includes("@@")) {
				feedbackMsg = [
					"User accepted the changes with manual edits.",
					"Below is the diff showing what the User changed ON TOP OF your generation:",
					"",
					patch,
					"",
					"Please analyze these manual edits to understand the User's intent.",
				].join("\n");
			} else {
				feedbackMsg =
					"User accepted the changes (no manual modifications made).";
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

		try {
			await diffController.closeDiffEditor(this.state.editUri);
		} catch {
			// Ignore close errors
		}

		await this.tempFileHandler.cleanup();

		if (this.isNewFile) {
			await this.tempFileHandler.deleteNewEmptyFileSilently(
				this.state.originalUri,
			);
		}
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
	initialize(): void {
		if (this.initialized) {
			return;
		}
		this.initialized = true;
	}

	/**
	 * Request a new edit operation
	 */
	async requestEdit(
		uriInput: string,
		newContent: string,
		context: ToolContext,
		toolName: string = "edit_file",
	): Promise<string> {
		const uri = resolveUri(uriInput);
		if (!checkAccess(uri, context.allowedUris)) {
			throw new Error(
				`Access Denied: Agent is not allowed to edit ${uri.toString()}`,
			);
		}

		const uriKey = getUriKey(uri);

		// Cancel existing session for this file if any
		await this.cancelExistingTransaction(uriKey);

		// Check if file exists, create empty file if not
		const isNewFile = await ensureFileExists(uri);

		return new Promise<string>(async (resolve, reject) => {
			const transaction = new EditTransaction(
				uri,
				toolName,
				resolve,
				reject,
				isNewFile,
				context.signalTermination,
			);

			try {
				// Initialize temp files
				await transaction.initialize(newContent);

				// Register transaction
				this.transactions.set(uriKey, transaction);

				// Open diff editor
				await this.diffController.openDiff(uri, transaction.getEditUri());

				// Determine auto-approve status
				const shouldAutoApprove =
					isAutoApproveEnabled() || isInRuleParsingMode();

				// Register with Permission Manager
				const requestId = approvalManager.createRequest(
					`Edit File: ${path.basename(uri.path)}`,
					uri.toString(),
					{
						onApprove: async () => {
							try {
								const feedbackMsg = await transaction.accept();
								this.transactions.delete(uriKey);
								transaction.resolve(feedbackMsg);
								await transaction.cleanup(this.diffController);
							} catch (e: any) {
								this.transactions.delete(uriKey);
								transaction.reject(e);
								await transaction.cleanup(this.diffController);
								throw e;
							}
						},
						onReject: async () => {
							const feedbackMsg = await handleRejectionFlow(
								transaction.state.toolName,
								transaction.state.signalTermination!,
							);
							this.transactions.delete(uriKey);
							transaction.resolve(feedbackMsg);
							await transaction.cleanup(this.diffController);
						},
						customAction: {
							label: "Review Diff",
							handler: async () => {
								try {
									await this.diffController.openDiff(
										uri,
										transaction.getEditUri(),
									);
								} catch (e: any) {
									vscode.window.showErrorMessage(
										`Failed to reopen editor: ${e.message}`,
									);
								}
							},
						},
					},
					"Review changes in Diff Editor. You can edit the right side (User Final) manually.",
					shouldAutoApprove,
				);

				transaction.state.approvalRequestId = requestId;

				// Handle cancellation (from LLM side / user aborting generation)
				if (context.abortSignal) {
					context.abortSignal.addEventListener("abort", () => {
						this.handleCancellation(uriKey, requestId);
					});
				}

				// Native OS notification only when user action is required.
				if (!shouldAutoApprove) {
					notifyApprovalNeeded(
						`Agent wants to edit ${path.basename(uri.path)}`,
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
		if (!existingTx || existingTx.isResolved()) {
			return;
		}
		if (existingTx.state.approvalRequestId) {
			await approvalManager.cancelRequest(existingTx.state.approvalRequestId);
		}
		this.transactions.delete(uriKey);
		existingTx.resolve(
			`[Interrupted] The ${existingTx.state.toolName} tool execution was overridden by a new request.`,
		);
		await existingTx.cleanup(this.diffController);
	}

	/**
	 * Handle transaction cancellation
	 */
	private async handleCancellation(
		uriKey: string,
		requestId: string,
	): Promise<void> {
		const transaction = this.transactions.get(uriKey);
		if (transaction && !transaction.isResolved()) {
			await approvalManager.cancelRequest(requestId);
			this.transactions.delete(uriKey);
			transaction.resolve(
				`[Interrupted] The ${transaction.state.toolName} tool execution was forcibly stopped by the user.`,
			);
			await transaction.cleanup(this.diffController);
		}
	}
}

// ============================================================================
// Legacy Exports - Compatibility Adapters
// ============================================================================

export function activateEditSupport(_context: vscode.ExtensionContext): void {
	EditService.getInstance().initialize();
}

export async function handleEdit(
	uriInput: string,
	newContent: string,
	context: ToolContext,
	toolName: string = "edit_file",
): Promise<string> {
	return EditService.getInstance().requestEdit(
		uriInput,
		newContent,
		context,
		toolName,
	);
}
