import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export class ImagePasteProvider implements vscode.DocumentPasteEditProvider {
    
    async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        
        // Check for image data
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

        // 1. Prepare temp file path
        const tempDir = path.join(os.tmpdir(), 'mutsumi_images');
        
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(tempDir));
        } catch (e) {
            // Ignore if exists
        }

        // Generate unique filename
        const timestamp = new Date().getTime();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const fileName = `img_${timestamp}_${randomSuffix}.${extension}`;
        const filePath = path.join(tempDir, fileName);
        const fileUri = vscode.Uri.file(filePath);

        // 2. Write file
        const data = await file.data();
        await vscode.workspace.fs.writeFile(fileUri, data);

        // 3. Construct Markdown link
        const markdownLink = `![image](${fileUri.toString()})`;

        // 4. Return Edit
        // Constructor: new DocumentPasteEdit(insertText, title, kind?)
        // Explicitly passing undefined for the 3rd argument to satisfy "Expected 3 arguments" if strict.

        const edit = new vscode.DocumentPasteEdit(markdownLink, "Paste Image to Temp", vscode.DocumentDropOrPasteEditKind.Text);
        
        // Use yieldTo to ensure we don't conflict with other providers if necessary, 
        // but here we want to handle it.
        
        return [edit];
    }
}
