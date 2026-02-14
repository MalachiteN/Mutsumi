import { ITool, ToolContext } from '../interface';
import { resolveUri } from '../utils';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';

export const searchFileContainsKeywordTool: ITool = {
    name: 'search_file_contains_keyword',
    definition: {
        type: 'function',
        function: {
            name: 'search_file_contains_keyword',
            description: 'Search for a keyword in files. Returns file paths and line numbers. Equivalent to `grep -rn keyword uri`.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The directory URI to start search.' },
                    keyword: { type: 'string', description: 'The keyword to search for.' }
                },
                required: ['uri', 'keyword']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, keyword } = args;
            if (!uriInput || !keyword) return 'Error: Missing arguments.';
            
            const rootUri = resolveUri(uriInput);
            
            // Note: workspace.findFiles works globally on the workspace if no base URI provided,
            // or relative to workspace folders.
            // It allows a RelativePattern to scope search.
            // RelativePattern requires a WorkspaceFolder OR a URI base.
            // VS Code API says: new RelativePattern(base: WorkspaceFolder | Uri | string, pattern: string)
            
            const relativePattern = new vscode.RelativePattern(rootUri, '**/*');

            // 2. Use findFiles
            const files = await vscode.workspace.findFiles(relativePattern);

            if (files.length === 0) return 'No files found in directory.';

            let result = '';
            
            // 3. Concurrent Read
            const searchPromises = files.map(async (fileUri) => {
                try {
                    const bytes = await vscode.workspace.fs.readFile(fileUri);
                    const content = new TextDecoder().decode(bytes);
                    
                    if (content.includes('\0')) return null;

                    const lines = content.split(/\r?\n/);
                    let fileResult = '';
                    
                    lines.forEach((line, idx) => {
                        if (line.includes(keyword)) {
                            // Display path relative to search root
                            const relPath = fileUri.toString().startsWith(rootUri.toString()) 
                                ? fileUri.toString().substring(rootUri.toString().length) 
                                : vscode.workspace.asRelativePath(fileUri);
                            
                            // Remove leading slash if any from simple substring
                            const displayPath = relPath.startsWith('/') ? relPath.substring(1) : relPath;

                            const displayLine = line.length > 300 ? line.substring(0, 300) + '...' : line;
                            fileResult += `${displayPath}:${idx + 1}:${displayLine.trim()}\n`;
                        }
                    });
                    return fileResult;
                } catch (e) {
                    return null;
                }
            });

            const results = await Promise.all(searchPromises);
            result = results.filter(r => r).join('');

            return result || 'No matches found.';
        } catch (err: any) {
            return `Error performing search: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `🔍 Mutsumi grepped "${args.keyword || '(unknown)'}" in ${args.uri || '(unknown directory)'}`;
    }
};

export const searchFileNameIncludesTool: ITool = {
    name: 'search_file_name_includes',
    definition: {
        type: 'function',
        function: {
            name: 'search_file_name_includes',
            description: 'Find files whose names include the specified string. Equivalent to `find uri -name "*name_includes*"`.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The directory URI to start search.' },
                    name_includes: { type: 'string', description: 'The string that filenames must contain.' }
                },
                required: ['uri', 'name_includes']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, name_includes } = args;
            if (!uriInput || !name_includes) return 'Error: Missing arguments.';

            const rootUri = resolveUri(uriInput);
            
            // Glob: **/*name_includes*
            const pattern = `**/*${name_includes}*`;
            const relativePattern = new vscode.RelativePattern(rootUri, pattern);

            const files = await vscode.workspace.findFiles(relativePattern, null, 200);

            if (files.length === 0) return 'No files found.';

            // Output relative paths
            return files.map(uri => {
                 return uri.toString().startsWith(rootUri.toString()) 
                    ? uri.toString().substring(rootUri.toString().length + (rootUri.toString().endsWith('/') ? 0 : 1)) 
                    : vscode.workspace.asRelativePath(uri);
            }).join('\n');
        } catch (err: any) {
            return `Error searching filenames: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `🔍 Mutsumi searched files named "*${args.name_includes || '(unknown)*'}*" in ${args.uri || '(unknown directory)'}`;
    }
};