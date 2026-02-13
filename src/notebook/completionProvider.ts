import * as vscode from 'vscode';
import * as path from 'path';
import { isCommonIgnored } from '../tools.d/utils';
import { ToolManager } from '../tools.d/toolManager';

/**
 * @description Provider class for reference auto-completion functionality
 * @class ReferenceCompletionProvider
 * @implements {vscode.CompletionItemProvider}
 */
export class ReferenceCompletionProvider implements vscode.CompletionItemProvider {

    /**
     * @description Provide completion items
     */
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {

        // Check trigger condition: user inputs @ followed by optional path characters
        const linePrefix = document.lineAt(position).text.substr(0, position.character);

        const match = linePrefix.match(/@([^@\s]*)$/);
        if (!match) {
            return [];
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];

        const items: vscode.CompletionItem[] = [];

        // 2. File suggestions (using findFiles)
        const files = await vscode.workspace.findFiles('**/*', undefined, 5000, token);

        for (const file of files) {
            if (token.isCancellationRequested) break;

            const relPath = vscode.workspace.asRelativePath(file);

            if (relPath.split(/[/\\]/).some(part => isCommonIgnored(part))) {
                continue;
            }

            const item = new vscode.CompletionItem(relPath, vscode.CompletionItemKind.File);

            item.insertText = `[${relPath}]`;
            item.detail = 'File Reference';
            item.documentation = new vscode.MarkdownString(`Reference content of \`${relPath}\``);
            item.sortText = '000_' + relPath;
            items.push(item);
        }

        // 3. Directory suggestions (shallow scan)
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

        // 4. Tool suggestions (includes skills via ToolManager)
        try {
            const tm = ToolManager.getInstance();
            const tools = tm.getToolsDefinitions(false);

            for (const tool of tools) {
                const fn = (tool as any).function;
                const name = fn.name;
                const desc = fn.description || 'Tool';
                const parameters = fn.parameters || {};

                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                item.detail = 'Tool/Skill Call';

                const properties = parameters.properties || {};
                const required = parameters.required || [];
                const paramNames = Object.keys(properties);

                if (paramNames.length === 0) {
                    item.insertText = `[${name}{}]`;
                } else {
                    const snippets: string[] = [];
                    paramNames.forEach((paramName) => {
                        const paramDef = properties[paramName];
                        const paramType = paramDef.type || 'any';

                        let defaultValue = '""';
                        if (paramType === 'number' || paramType === 'integer') {
                            defaultValue = '0';
                        } else if (paramType === 'boolean') {
                            defaultValue = 'false';
                        } else if (paramType === 'array') {
                            defaultValue = '[]';
                        } else if (paramType === 'object') {
                            defaultValue = '{}';
                        }

                        snippets.push(`"${paramName}": ${defaultValue}`);
                    });

                    item.insertText = new vscode.SnippetString(
                        `[${name}{${snippets.join(', ')}}]`
                    );
                }

                let docContent = desc;
                if (paramNames.length > 0) {
                    docContent += '\n\n**Parameters:**\n\n';
                    paramNames.forEach(paramName => {
                        const paramDef = properties[paramName];
                        const isRequired = required.includes(paramName);
                        const paramType = paramDef.type || 'any';
                        const paramDesc = paramDef.description || '';

                        const reqMarker = isRequired ? '**(required)**' : '(optional)';
                        docContent += `- \`${paramName}\` \`${paramType}\` ${reqMarker}`;
                        if (paramDesc) {
                            docContent += ` - ${paramDesc}`;
                        }
                        docContent += '\n';
                    });
                }
                item.documentation = new vscode.MarkdownString(docContent);
                item.sortText = '002_' + name;
                items.push(item);
            }
        } catch (e) {
            // Ignore tool retrieval errors
        }

        return items;
    }
}
