import { ITool, ToolContext } from '../interface';
import { resolveUri } from '../utils';
import { requestApproval } from '../permission';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export const shellExecTool: ITool = {
    name: 'shell_exec',
    definition: {
        type: 'function',
        function: {
            name: 'shell_exec',
            description: 'Execute a shell command. Requires user approval. **IMPORTANT**: Run `system_info` first to find available shells and their paths.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The URI where command should be executed (CWD).' },
                    cmd: { type: 'string', description: 'The shell command to execute.' },
                    shell_path: { type: 'string', description: 'Absolute path to the shell executable (e.g. /bin/bash, C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe). If omitted, defaults to system default.' }
                },
                required: ['uri', 'cmd']
            }
        },
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput, cmd, shell_path: shellPath } = args;
            if (!uriInput || !cmd) return 'Error: Missing "uri" or "cmd" argument.';

            const uri = resolveUri(uriInput);

            // Check capability: Shell execution is only possible if the URI maps to a file system
            // capable of spawning processes via child_process.
            // Locally: 'file' scheme -> OK.
            // Remote: 'vscode-remote' scheme -> The extension host runs remotely, so 'file' scheme there is fine.
            // But if we are in a virtual fs (e.g. 'memfs', 'ftp', 'github'), child_process won't work on that path.
            
            // Note: resolveUri might return a URI with a custom scheme.
            // If scheme is NOT 'file' (and not 'vscode-remote' which usually appears as 'file' inside the ext host?),
            // we should warn or block.
            // Actually, in remote dev, workspace URI is 'file://' BUT it maps to remote OS. 
            // So check generally passes. 
            // If it is 'ssh://...' or 'ftp://...' handled by FileSystemProvider, child_process cannot set CWD to it.
            
            if (uri.scheme !== 'file') {
                return `Error: shell_exec only supports 'file' scheme (local or remote OS file system). Current scheme: '${uri.scheme}'. virtual file systems do not support shell execution.`;
            }

            const cwd = uri.fsPath; // Safe to use fsPath here because we confirmed scheme is file
            const shellName = shellPath ? path.basename(shellPath) : 'System Default Shell';

            // User Approval via sidebar
            const details = `Command:\n${cmd}\n\nShell: ${shellName}`;
            const approved = await requestApproval(
                `Execute Shell Command at ${uriInput}`,
                uriInput,
                context,
                details
            );

            if (!approved) {
                return 'User rejected the shell command execution.';
            }

            // Execution
            const execOptions: cp.ExecOptions = { cwd };
            if (shellPath) {
                execOptions.shell = shellPath;
            }

            return new Promise((resolve) => {
                cp.exec(cmd, execOptions, (error, stdout, stderr) => {
                    const outputParts = [];
                    if (stdout) outputParts.push(`STDOUT:\n${stdout}`);
                    if (stderr) outputParts.push(`STDERR:\n${stderr}`);
                    if (error) outputParts.push(`ERROR:\n${error.message}`);
                    
                    resolve(outputParts.join('\n').trim() || 'Command executed with no output.');
                });
            });

        } catch (err: any) {
            return `Error preparing shell execution: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        const cmdPreview = args.cmd ? (args.cmd.length > 40 ? args.cmd.substring(0, 40) + '...' : args.cmd) : '(unknown command)';
        return `⚡ Mutsumi executed "${cmdPreview}" in ${args.uri || '(unknown directory)'}`;
    },
    argsToCodeBlock: ['cmd'],
    codeBlockFilePaths: [ 'dummy.sh' ]
};