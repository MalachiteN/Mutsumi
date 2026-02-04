import { ITool, ToolContext } from './interface';
import { resolveUri } from './utils';
import * as vscode from 'vscode';

export const partiallyReadByRangeTool: ITool = {
    name: 'partially_read_by_range',
    definition: {
        type: 'function',
        function: {
            name: 'partially_read_by_range',
            description: 'Read a file content within a specific line range.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The file URI.' },
                    start_line: { type: 'integer', description: 'Start line number (1-based).' },
                    end_line: { type: 'integer', description: 'End line number (1-based).' }
                },
                required: ['uri', 'start_line', 'end_line']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, start_line: m, end_line: n } = args;
            if (!uriInput || m === undefined || n === undefined) return 'Error: Missing arguments.';

            const uri = resolveUri(uriInput);
            
            // 使用 openTextDocument 加载文档对象 (这比 raw fs 读取更安全，处理了编码和换行)
            const doc = await vscode.workspace.openTextDocument(uri);
            const lineCount = doc.lineCount;

            // 修正范围，防止越界
            const start = Math.max(0, m - 1);
            const end = Math.min(lineCount - 1, n - 1);

            if (start > end) return '(Range invalid or out of bounds)';

            const resultLines: string[] = [];
            for (let i = start; i <= end; i++) {
                // doc.lineAt(i).text 获取该行纯文本（不含换行符）
                resultLines.push(`${i + 1}: ${doc.lineAt(i).text}`);
            }

            return resultLines.join('\n');
        } catch (err: any) {
            return `Error reading file range: ${err.message}`;
        }
    }
};

export const partiallyReadAroundKeywordTool: ITool = {
    name: 'partially_read_around_keyword',
    definition: {
        type: 'function',
        function: {
            name: 'partially_read_around_keyword',
            description: 'Search for a keyword in a file and return matching lines with context.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The file URI.' },
                    keyword: { type: 'string', description: 'The string to search for.' },
                    lines_before: { type: 'integer', description: 'Number of lines before match.' },
                    lines_after: { type: 'integer', description: 'Number of lines after match.' }
                },
                required: ['uri', 'keyword', 'lines_before', 'lines_after']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, keyword, lines_before: a, lines_after: b } = args;
            if (!uriInput || !keyword) return 'Error: Missing arguments.';

            const uri = resolveUri(uriInput);
            const doc = await vscode.workspace.openTextDocument(uri);
            const lineCount = doc.lineCount;

            const indicesToKeep = new Set<number>();

            // 遍历文档行
            for (let i = 0; i < lineCount; i++) {
                const lineText = doc.lineAt(i).text;
                if (lineText.includes(keyword)) {
                    const start = Math.max(0, i - a);
                    const end = Math.min(lineCount - 1, i + b);
                    for (let j = start; j <= end; j++) {
                        indicesToKeep.add(j);
                    }
                }
            }

            if (indicesToKeep.size === 0) return `No matches found for "${keyword}".`;

            const sortedIndices = Array.from(indicesToKeep).sort((x, y) => x - y);
            
            let result = '';
            let prevIndex = -1;

            sortedIndices.forEach(idx => {
                if (prevIndex !== -1 && idx > prevIndex + 1) {
                    result += '...\n';
                }
                result += `${idx + 1}: ${doc.lineAt(idx).text}\n`;
                prevIndex = idx;
            });

            return result.trim();
        } catch (err: any) {
            return `Error searching file: ${err.message}`;
        }
    }
};