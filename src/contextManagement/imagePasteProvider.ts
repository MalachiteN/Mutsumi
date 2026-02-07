import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Image Paste Provider Class
 * @description Implements VSCode's DocumentPasteEditProvider interface, handles image paste operations into documents
 * @description Saves pasted images to temporary directory and inserts Markdown image link
 * @implements {vscode.DocumentPasteEditProvider}
 * @example
 * // Register in extension.ts
 * vscode.languages.registerDocumentPasteEditProvider(
 *   { pattern: '** /*.md' },
 *   new ImagePasteProvider(),
 *   { pasteMimeTypes: ['image/png', 'image/jpeg'] }
 * );
 */
export class ImagePasteProvider implements vscode.DocumentPasteEditProvider {

    /**
     * @description Provide document paste edit operations
     * @param {vscode.TextDocument} document - Target document
     * @param {readonly vscode.Range[]} ranges - Array of ranges for paste position
     * @param {vscode.DataTransfer} dataTransfer - Clipboard data transfer object
     * @param {vscode.DocumentPasteEditContext} context - Paste edit context
     * @param {vscode.CancellationToken} token - Cancellation token
     * @returns {Promise<vscode.DocumentPasteEdit[] | undefined>} Array of paste edit operations, returns undefined if not an image
     * @description Supports pasting PNG and JPEG format images
     * @description Images will be saved to mutsumi_images folder in system temp directory
     * @example
     * // Automatically triggered when user pastes image into document
     * // Result: ![image](file:///tmp/mutsumi_images/img_1234567890_abcdef.png)
     */
    async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {

        // Check image data
        let imageItem = dataTransfer.get('image/png');
        let mimeType = 'image/png';

        if (!imageItem) {
            imageItem = dataTransfer.get('image/jpeg');
            mimeType = 'image/jpeg';
        }

        if (!imageItem) {
            return undefined;
        }

        const file = imageItem.asFile();
        if (!file) {
            return undefined;
        }

        // Prepare temporary file path
        const tempDir = path.join(os.tmpdir(), 'mutsumi_images');

        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(tempDir));
        } catch (e) {
            // Ignore error if directory already exists
        }

        // Generate unique filename
        const timestamp = new Date().getTime();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const fileName = `img_${timestamp}_${randomSuffix}.${extension}`;
        const filePath = path.join(tempDir, fileName);
        const fileUri = vscode.Uri.file(filePath);

        // Write file
        const data = await file.data();
        await vscode.workspace.fs.writeFile(fileUri, data);

        // Construct Markdown link
        const markdownLink = `![image](${fileUri.toString()})`;

        // Create and return edit operation
        const edit = new vscode.DocumentPasteEdit(
            markdownLink,
            "Paste Image to Temp",
            vscode.DocumentDropOrPasteEditKind.Text
        );

        return [edit];
    }
}
