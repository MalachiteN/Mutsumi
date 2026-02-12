import { ITool, ToolContext } from './interface';
import { resolveUri, checkAccess } from './utils';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';

export const readFileTool: ITool = {
    name: 'read_file',
    definition: {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file at the given URI.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The file URI or path to read.' }
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

            const bytes = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(bytes);
        } catch (err: any) {
            return `Error reading file: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `📖 Mutsumi read ${args.uri || '(unknown file)'}`;
    }
};