import * as vscode from 'vscode';
import * as path from 'path';
import { isCommonIgnored } from './tools.d/utils';

export class ReferenceCompletionProvider implements vscode.CompletionItemProvider {
    
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        
        // 1. Trigger Check
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.endsWith('@')) {
            return [];
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];
        
        const items: vscode.CompletionItem[] = [];

        // 2. File Suggestions (Using findFiles)
        // findFiles 自动排除 .gitignore 和用户设置中排除的文件
        // 第二个参数 exclude = undefined 表示使用默认排除规则
        const files = await vscode.workspace.findFiles('**/*', undefined, 50, token);

        for (const file of files) {
            if (token.isCancellationRequested) break;

            const relPath = vscode.workspace.asRelativePath(file);
            const item = new vscode.CompletionItem(relPath, vscode.CompletionItemKind.File);
            
            item.insertText = `[${relPath}]`; 
            item.detail = 'File Reference';
            item.documentation = new vscode.MarkdownString(`Reference content of \`${relPath}\``);
            // 提高文件匹配的优先级
            item.sortText = '000_' + relPath; 
            items.push(item);
        }
        
        // 3. Directory Suggestions (Shallow scan)
        // findFiles 只返回文件，所以对于目录，我们还是需要 readDirectory
        for (const folder of workspaceFolders) {
            if (token.isCancellationRequested) break;
            
            const folderRoot = folder.uri;
            try {
                const dirEntries = await vscode.workspace.fs.readDirectory(folderRoot);
                
                for (const [name, type] of dirEntries) {
                    if (type === vscode.FileType.Directory && !isCommonIgnored(name)) {
                        const prefix = workspaceFolders.length > 1 ? `${folder.name}/` : '';
                        const displayLabel = prefix + name + '/';
                        
                        const item = new vscode.CompletionItem(displayLabel, vscode.CompletionItemKind.Folder);
                        item.insertText = `[${displayLabel}]`;
                        item.detail = 'Directory Reference';
                        item.sortText = '001_' + displayLabel;
                        items.push(item);
                    }
                }
            } catch (e) {
                // Ignore read errors
            }
        }

        return items;
    }
}