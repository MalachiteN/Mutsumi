import { ITool, ToolContext } from '../interface';
import { resolveUri } from '../utils';
import { requestApproval } from '../permission';
import { toolsLogger } from '../toolsLogger';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

/**
 * Format a log line with timestamp.
 */
function shellLogger(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    toolsLogger.logLine(`[${timestamp}] [shell] ${message}`);
}

export const shellExecTool: ITool = {
    name: 'shell',
    definition: {
        type: 'function',
        function: {
            name: 'shell',
            description: 'Execute a shell command. Requires user approval.',
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
                return `Error: shell only supports 'file' scheme (local or remote OS file system). Current scheme: '${uri.scheme}'. virtual file systems do not support shell execution.`;
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

            // Log command start
            shellLogger(`Command: ${cmd}`);
            shellLogger(`Working directory: ${cwd}`);
            shellLogger(`Shell: ${shellName}`);
            shellLogger('--- Execution Start ---');

            // Execution using spawn for streaming output
            const spawnOptions: cp.SpawnOptions = { 
                cwd,
                shell: shellPath || true  // true = system default shell, or specify path
            };

            return new Promise((resolve) => {
                const child = cp.spawn(cmd, [], spawnOptions);
                
                let stdout = '';
                let stderr = '';

                // Stream stdout to logger and buffer
                child.stdout?.on('data', (chunk: Buffer) => {
                    const text = chunk.toString();
                    toolsLogger.log(text);
                    stdout += text;
                });

                // Stream stderr to logger and buffer
                child.stderr?.on('data', (chunk: Buffer) => {
                    const text = chunk.toString();
                    toolsLogger.log(text);
                    stderr += text;
                });

                // Handle process exit
                child.on('exit', (code, signal) => {
                    const signalInfo = signal ? ` (signal: ${signal})` : '';
                    shellLogger('--- Execution End ---');
                    shellLogger(`Exit code: ${code !== null ? code : 'null'}${signalInfo}`);

                    const outputParts = [`Exit Code: ${code}`];

                    if (stdout) outputParts.push(`STDOUT:\n${stdout}`);
                    if (stderr) outputParts.push(`STDERR:\n${stderr}`);
                    if (signal) outputParts.push(`Signal: ${signal}`);

                    resolve(outputParts.join('\n\n').trim());
                });

                // Handle spawn errors (e.g., command not found)
                child.on('error', (err) => {
                    shellLogger(`--- Execution Error: ${err.message} ---`);
                    resolve(`Exit Code: -1\n\nERROR:\n${err.message}`);
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
    codeBlockFilePaths: [ undefined ]
};