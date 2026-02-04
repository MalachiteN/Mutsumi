import { ITool, ToolContext } from './interface';
import { resolveUri, checkAccess } from './utils';
import * as vscode from 'vscode';

export const lsTool: ITool = {
    name: 'ls',
    definition: {
        type: 'function',
        function: {
            name: 'ls',
            description: 'List files and directories at the given URI.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The directory URI or path to list.' }
                },
                required: ['uri']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const uriInput = args.uri;
            if (!uriInput) return 'Error: Missing "uri" argument.';

            const uri = resolveUri(uriInput);

            const entries = await vscode.workspace.fs.readDirectory(uri);
            entries.sort((a, b) => {
                if (a[1] === b[1]) return a[0].localeCompare(b[0]);
                return a[1] === vscode.FileType.Directory ? -1 : 1;
            });

            const result = entries.map(([name, type]) => {
                const typeStr = type === vscode.FileType.Directory ? 'DIR ' : 
                                type === vscode.FileType.File ? 'FILE' : 
                                type === vscode.FileType.SymbolicLink ? 'LINK' : 'UNKN';
                return `[${typeStr}] ${name}`;
            }).join('\n');

            return result || '(Empty Directory)';
        } catch (err: any) {
            return `Error listing directory: ${err.message}`;
        }
    }
};