import type { ITool, ToolContext } from "../interface";
import { resolveUri } from "../utils";
import { requestApproval } from "../permission";
import { toolsLogger } from "../toolsLogger";
import * as path from "path";
import { ShellTask, formatShellOutput } from "../shell/shellTask";
import { shellTaskRegistry } from "../shell/registry";

function shellLogger(message: string): void {
	const timestamp = new Date().toLocaleTimeString();
	toolsLogger.logLine(`[${timestamp}] [shell] ${message}`);
}

export const shellTool: ITool = {
	name: "shell",
	definition: {
		type: "function",
		function: {
			name: "shell",
			description:
				"Execute a shell command. Requires user approval. By default waits for the command to finish (sync). Set background=true to start it detached and return immediately with a task id; use get_shell_output to inspect its output later.",
			parameters: {
				type: "object",
				properties: {
					uri: {
						type: "string",
						description: "The URI where command should be executed (CWD).",
					},
					cmd: { type: "string", description: "The shell command to execute." },
					shell_path: {
						type: "string",
						description:
							"Absolute path to the shell executable (e.g. /bin/bash, C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe). If omitted, defaults to system default.",
					},
					background: {
						type: "boolean",
						description:
							"If true, run detached and return immediately with a task id without waiting for exit. Use get_shell_output to inspect. Default: false (sync wait for exit).",
					},
				},
				required: ["uri", "cmd"],
			},
		},
	},
	execute: async (args: any, context: ToolContext) => {
		try {
			const { uri: uriInput, cmd, shell_path: shellPath, background } = args;
			if (!uriInput || !cmd) return 'Error: Missing "uri" or "cmd" argument.';

			const uri = resolveUri(uriInput);

			if (uri.scheme !== "file") {
				return `Error: shell only supports 'file' scheme (local or remote OS file system). Current scheme: '${uri.scheme}'. virtual file systems do not support shell execution.`;
			}

			const cwd = uri.fsPath;
			const shellName = shellPath
				? path.basename(shellPath)
				: "System Default Shell";

			const details = `Command:\n${cmd}\n\nShell: ${shellName}\nBackground: ${background ? "yes" : "no"}`;
			const rejectionMsg = await requestApproval(
				`Execute "${cmd}" at ${uriInput}`,
				uriInput,
				context,
				"shell",
				details,
			);

			if (rejectionMsg !== null) {
				return rejectionMsg;
			}

			shellLogger(`Command: ${cmd}`);
			shellLogger(`Working directory: ${cwd}`);
			shellLogger(`Shell: ${shellName}`);
			shellLogger(`Background: ${background ? "yes" : "no"}`);
			shellLogger("--- Execution Start ---");

			const task = new ShellTask({
				cmd,
				cwd,
				shellPath,
				agentSessionId: context.session.id,
				abortSignal: context.toolSession.abortSignal,
			});

			if (background) {
				shellTaskRegistry.register(task);
				shellLogger("--- Detached, returned task id ---");
				return `[Background] Started shell task ${task.id}, detached.\nCommand: ${cmd}\nUse get_shell_output with task_id="${task.id}" to inspect output.`;
			}

			// sync: wait for exit, abort via toolSession already bridges to task.abort()
			await task.waitForExit();
			const snap = task.snapshot();
			shellLogger("--- Execution End ---");
			shellLogger(
				`Exit code: ${snap.exitCode}${snap.aborted ? " (aborted)" : ""}`,
			);

			return formatShellOutput(snap, { showExit: true });
		} catch (err: any) {
			return `Error preparing shell execution: ${err.message}`;
		}
	},
	prettyPrint: (args: any) => {
		const cmdPreview = args.cmd
			? args.cmd.length > 40
				? args.cmd.substring(0, 40) + "..."
				: args.cmd
			: "(unknown command)";
		const mode = args.background ? "[background] " : "";
		return `⚡ Mutsumi executed ${mode}"${cmdPreview}" in ${args.uri || "(unknown directory)"}`;
	},
	argsToCodeBlock: ["cmd"],
	codeBlockFilePaths: [undefined],
};
