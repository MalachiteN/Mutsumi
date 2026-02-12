import { ITool, ToolContext } from './interface';
import { resolveUri, checkAccess, requestApproval } from './utils';
import * as vscode from 'vscode';
import { TextEncoder } from 'util';

export const mkdirTool: ITool = {
    name: 'mkdir',
    definition: {
        type: 'function',
        function: {
            name: 'mkdir',
            description: 'Create a directory recursively (like `mkdir -p`). Requires User Approval.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The directory path to create.' }
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

            // Access Control
            if (!checkAccess(uri, context.allowedUris)) {
                return `Access Denied: Agent is not allowed to write to ${uri.toString()}`;
            }

            // Approval
            if (!(await requestApproval('Create Directory (mkdir -p)', uriInput, context))) {
                return 'User rejected the operation.';
            }

            await vscode.workspace.fs.createDirectory(uri);
            
            return `Directory created: ${uriInput}`;
        } catch (err: any) {
            return `Error creating directory: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `📂 Mutsumi created directory ${args.uri || '(unknown path)'}`;
    }
};

export const createNewFileTool: ITool = {
    name: 'create_file',
    definition: {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file with content. Overwrites existing files. Fails if parent directory does not exist. Like `echo "content" > uri`. Requires User Approval.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The file path.' },
                    content: { type: 'string', description: 'The content to write.' }
                },
                required: ['uri', 'content']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const uriInput = args.uri;
            const content = args.content;
            if (!uriInput || content === undefined) return 'Error: Missing arguments.';

            const uri = resolveUri(uriInput);

            // Access Control
            if (!checkAccess(uri, context.allowedUris)) {
                return `Access Denied: Agent is not allowed to write to ${uri.toString()}`;
            }

            // Approval
            if (!(await requestApproval('Create/Overwrite File', uriInput, context))) {
                return 'User rejected the operation.';
            }

            // 如果经过的路径不存在，工具调用失败
            // This implies we do NOT do mkdir -p for the file parent. 
            // We just try to write.
            const encoded = new TextEncoder().encode(content);
            await vscode.workspace.fs.writeFile(uri, encoded);

            return `File created successfully: ${uriInput}`;
        } catch (err: any) {
            return `Error creating file (Parent dir might not exist): ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `🆕 Mutsumi created file ${args.uri || '(unknown path)'}`;
    }
};