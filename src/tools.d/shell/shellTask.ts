import * as cp from "child_process";
import { v4 as uuidv4 } from "uuid";

export interface ShellTaskOptions {
	cmd: string;
	cwd: string;
	shellPath?: string;
	agentSessionId: string;
	abortSignal?: AbortSignal;
	background?: boolean;
}

export interface ShellTaskSnapshot {
	running: boolean;
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	aborted: boolean;
}

/**
 * Format a shell task snapshot for display.
 * When `showExit` is false and the task is still running, omits the exit block.
 */
export function formatShellOutput(
	snap: ShellTaskSnapshot,
	opts: { showExit: boolean },
): string {
	const parts: string[] = [];
	if (snap.stdout) parts.push(`STDOUT:\n${snap.stdout}`);
	if (snap.stderr) parts.push(`STDERR:\n${snap.stderr}`);
	const showExit = opts.showExit || !snap.running;
	if (showExit) {
		if (snap.aborted) {
			parts.push(`Exit Code: (aborted by user)`);
		} else {
			const sig = snap.signal ? ` (signal: ${snap.signal})` : "";
			parts.push(`Exit Code: ${snap.exitCode}${sig}`);
		}
	}
	return parts.join("\n\n").trim() || "(no output)";
}

/**
 * Proxy for a detached child process. Buffers full stdout/stderr, supports
 * abort via SIGTERM, and survives after the process exits so a later
 * get_shell_output / kill_shell_task call can still collect the output.
 */
export class ShellTask {
	readonly id: string;
	readonly agentSessionId: string;
	readonly cmd: string;
	readonly cwd: string;
	readonly createdAt: number;
	background: boolean;

	private child: cp.ChildProcess;
	private stdoutBuf = "";
	private stderrBuf = "";
	private exitCode: number | null = null;
	private exitSignal: string | null = null;
	private aborted = false;
	private onExitCbs: Array<() => void> = [];
	private detachCbs: Array<() => void> = [];

	constructor(opts: ShellTaskOptions) {
		this.id = uuidv4();
		this.agentSessionId = opts.agentSessionId;
		this.cmd = opts.cmd;
		this.cwd = opts.cwd;
		this.createdAt = Date.now();
		this.background = !!opts.background;

		this.child = cp.spawn(opts.cmd, [], {
			cwd: opts.cwd,
			shell: opts.shellPath || true,
			detached: true,
		});

		opts.abortSignal?.addEventListener("abort", () => this.abort());

		this.child.stdout?.on("data", (d: Buffer) => {
			this.stdoutBuf += d.toString();
		});
		this.child.stderr?.on("data", (d: Buffer) => {
			this.stderrBuf += d.toString();
		});
		this.child.on("exit", (code, signal) => {
			this.exitCode = code;
			this.exitSignal = signal;
			this.fireExit();
		});
		this.child.on("error", (err) => {
			this.stderrBuf += `\n[spawn error] ${err.message}\n`;
			this.exitCode = -1;
			this.fireExit();
		});
	}

	get isRunning(): boolean {
		return this.exitCode === null && !this.aborted;
	}
	get isExited(): boolean {
		return this.exitCode !== null;
	}
	get wasAborted(): boolean {
		return this.aborted;
	}

	snapshot(): ShellTaskSnapshot {
		return {
			running: this.isRunning,
			stdout: this.stdoutBuf,
			stderr: this.stderrBuf,
			exitCode: this.exitCode,
			signal: this.exitSignal,
			aborted: this.aborted,
		};
	}

	abort(): void {
		if (this.aborted || this.isExited) return;
		this.aborted = true;
		try {
			this.child.kill("SIGTERM");
		} catch {
			/* ignore */
		}
	}

	/**
	 * Move a running sync task to the background. Resolves the pending
	 * sync wait so the agent's shell tool call returns immediately with a
	 * "moved to background" notice. No-op if the task already exited.
	 */
	detachToBackground(): void {
		if (this.isExited || this.background) return;
		this.background = true;
		const cbs = this.detachCbs;
		this.detachCbs = [];
		cbs.forEach((fn) => {
			try {
				fn();
			} catch {
				/* ignore */
			}
		});
	}

	onDetach(cb: () => void): void {
		this.detachCbs.push(cb);
	}

	onExit(cb: () => void): void {
		if (this.isExited) {
			cb();
		} else {
			this.onExitCbs.push(cb);
		}
	}

	waitForExit(): Promise<void> {
		if (this.isExited) return Promise.resolve();
		return new Promise<void>((resolve) => this.onExitCbs.push(resolve));
	}

	private fireExit(): void {
		const cbs = this.onExitCbs;
		this.onExitCbs = [];
		cbs.forEach((fn) => {
			try {
				fn();
			} catch {
				/* ignore */
			}
		});
	}
}
