import { ITool, ToolContext } from '../interface';
import { resolveUri } from '../utils';
import { requestApproval } from '../permission';
import * as vscode from 'vscode';
import * as cp from 'child_process';

export const gitCmdTool: ITool = {
    name: 'git_cmd',
    definition: {
        type: 'function',
        function: {
            name: 'git_cmd',
            description: 'Execute a git command in the specified directory. Requires explicit user approval via UI notification.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The repository root or subdirectory URI (CWD).' },
                    args: { type: 'string', description: 'The arguments for git (e.g., "status", "commit -m \"msg\"", "log --oneline"). Do NOT include "git" at the start.' }
                },
                required: ['uri', 'args']
            }
        },
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, args: gitArgs } = args;
            if (!uriInput || !gitArgs) return 'Error: Missing "uri" or "args" argument.';

            const uri = resolveUri(uriInput);
            
            if (uri.scheme !== 'file') {
                 return `Error: git_cmd only supports 'file' scheme. Current scheme: '${uri.scheme}'.`;
            }

            const cwd = uri.fsPath;
            
            // Remove 'git ' prefix if model hallucinated it
            const cleanArgs = gitArgs.trim().replace(/^git\s+/i, '');
            const fullCmd = `git ${cleanArgs}`;

            // User Approval via sidebar
            const approved = await requestApproval(
                `Execute Git Command`,
                uriInput,
                context,
                `Command: ${fullCmd}`
            );

            if (!approved) {
                return 'User rejected the git command execution.';
            }

            // 2. Execution
            return new Promise((resolve) => {
                cp.exec(fullCmd, { cwd }, (error, stdout, stderr) => {
                    const outputParts = [];
                    if (stdout) outputParts.push(`STDOUT:\n${stdout}`);
                    if (stderr) outputParts.push(`STDERR:\n${stderr}`);
                    if (error) outputParts.push(`ERROR CODE: ${error.code}\nMESSAGE: ${error.message}`);
                    
                    resolve(outputParts.join('\n').trim() || 'Git command executed successfully with no output.');
                });
            });

        } catch (err: any) {
            return `Error preparing git execution: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        const argsPreview = args.args ? (args.args.length > 30 ? args.args.substring(0, 30) + '...' : args.args) : '(unknown)';
        return `🔀 Mutsumi ran git ${argsPreview} in ${args.uri || '(unknown directory)'}`;
    }
};