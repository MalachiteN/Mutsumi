import { ITool, ToolContext } from './interface';
import { resolveUri, requestApproval } from './utils';
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
            const cwd = uri.fsPath;
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
    }
};