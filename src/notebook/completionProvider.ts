import * as vscode from 'vscode';
import * as path from 'path';
import { isCommonIgnored } from '../tools.d/utils';

export class ReferenceCompletionProvider implements vscode.CompletionItemProvider {
    
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        
        // 1. Trigger Check
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        
        // 允许 @ 后紧跟部分路径字符 (如 @sr -> src/)
        const match = linePrefix.match(/@([^@\s]*)$/);
        if (!match) {
            return [];
        }

        // 计算需要替换的范围：从 @ 后面的字符开始到光标位置
        // 例如 "@sr|" -> range 覆盖 "sr"，插入 "[src/main.ts]" -> "@[src/main.ts]"
        // 如果不指定 range，VS Code 可能会保留 "sr"，导致结果变为 "@[src/main.ts]sr"
        const userQuery = match[1];
        const range = new vscode.Range(
            position.translate(0, -userQuery.length),
            position
        );

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];
        
        const items: vscode.CompletionItem[] = [];

        // 2. File Suggestions (Using findFiles)
        // findFiles 自动排除 .gitignore 和用户设置中排除的文件
        // 第二个参数 exclude = undefined 表示使用默认排除规则
        // 增加最大结果数以避免列表被截断 (50 -> 5000)，同时手动过滤 ignored 目录以防万一
        const files = await vscode.workspace.findFiles('**/*', undefined, 5000, token);

        for (const file of files) {
            if (token.isCancellationRequested) break;

            const relPath = vscode.workspace.asRelativePath(file);

            // 手动过滤 ignored 目录 (如 out/)，确保即使 findFiles 漏网也能拦截
            // 使用正则兼容 Windows 反斜杠和 POSIX 正斜杠
            if (relPath.split(/[/\\]/).some(part => isCommonIgnored(part))) {
                continue;
            }

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