import { ITool, ToolContext } from './interface';
import { resolveUri } from './utils';
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
            
            // 1. 构建 Glob Pattern
            // 如果指定了目录，限制在该目录下；否则全工作区
            const rootUri = resolveUri(uriInput);
            const relativePattern = new vscode.RelativePattern(rootUri, '**/*');

            // 2. 使用 findFiles 获取文件列表
            // 这会自动遵循 .gitignore 和 files.exclude 设置
            // maxResults 设置为 undefined (不限制) 或者一个合理的数字防止卡死
            const files = await vscode.workspace.findFiles(relativePattern);

            if (files.length === 0) return 'No files found in directory.';

            let result = '';
            
            // 3. 并发读取文件内容并搜索
            // 为了避免打开过多文件句柄，这里可以简单的用 Promise.all 
            // 如果文件极多，可能需要分批处理，但作为 Agent 工具通常范围可控
            const searchPromises = files.map(async (fileUri) => {
                try {
                    const bytes = await vscode.workspace.fs.readFile(fileUri);
                    const content = new TextDecoder().decode(bytes);
                    
                    // 简单的二进制检查
                    if (content.includes('\0')) return null;

                    const lines = content.split(/\r?\n/);
                    let fileResult = '';
                    
                    lines.forEach((line, idx) => {
                        if (line.includes(keyword)) {
                            const relPath = vscode.workspace.asRelativePath(fileUri);
                            // 限制单行长度，防止极长行输出过多
                            const displayLine = line.length > 300 ? line.substring(0, 300) + '...' : line;
                            fileResult += `${relPath}:${idx + 1}:${displayLine.trim()}\n`;
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
            
            // 构建 Glob: **/*name_includes*
            const pattern = `**/*${name_includes}*`;
            const relativePattern = new vscode.RelativePattern(rootUri, pattern);

            // 使用 VS Code API 查找
            const files = await vscode.workspace.findFiles(relativePattern, null, 200);

            if (files.length === 0) return 'No files found.';

            return files.map(uri => vscode.workspace.asRelativePath(uri)).join('\n');
        } catch (err: any) {
            return `Error searching filenames: ${err.message}`;
        }
    }
};