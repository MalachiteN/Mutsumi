import * as vscode from "vscode";
import { type ShellTask, formatShellOutput } from "../tools.d/shell/shellTask";
import { shellTaskRegistry } from "../tools.d/shell/registry";

/**
 * Shell task tree node for the Shell Tasks sidebar view.
 */
export class ShellTaskTreeItem extends vscode.TreeItem {
	constructor(public readonly task: ShellTask) {
		const cmdPreview =
			task.cmd.length > 40 ? task.cmd.substring(0, 40) + "..." : task.cmd;
		super(cmdPreview, vscode.TreeItemCollapsibleState.None);

		this.description = this.formatDescription();
		this.tooltip = this.buildTooltip();
		this.iconPath = this.getIcon();
		this.contextValue = this.getContextValue();
	}

	private formatDescription(): string {
		const elapsed = Math.floor((Date.now() - this.task.createdAt) / 1000);
		if (this.task.isRunning) {
			return this.task.background ? `bg ${elapsed}s` : `fg ${elapsed}s`;
		}
		const snap = this.task.snapshot();
		if (snap.aborted) return "stopped";
		const sig = snap.signal ? ` (${snap.signal})` : "";
		return `exit ${snap.exitCode}${sig}`;
	}

	private buildTooltip(): vscode.MarkdownString {
		const md = new vscode.MarkdownString();
		md.appendMarkdown(`**${this.task.cmd}**\n\n`);
		md.appendMarkdown(`📁 CWD: \`${this.task.cwd}\`\n\n`);
		md.appendMarkdown(`🆔 Task: \`${this.task.id}\`\n\n`);
		md.appendMarkdown(`🖥️ Agent Session: \`${this.task.agentSessionId}\`\n\n`);
		md.appendMarkdown(
			`Mode: ${this.task.background ? "background" : "foreground"}\n\n`,
		);
		const snap = this.task.snapshot();
		if (snap.aborted) {
			md.appendMarkdown(`Status: 🛑 stopped\n\n`);
		} else if (this.task.isRunning) {
			md.appendMarkdown(`Status: ▶️ running\n\n`);
		} else {
			const sig = snap.signal ? ` (signal: ${snap.signal})` : "";
			md.appendMarkdown(`Status: ✅ exit ${snap.exitCode}${sig}\n\n`);
		}
		const out = formatShellOutput(snap, { showExit: true });
		if (out && out !== "(no output)") {
			md.appendMarkdown(`Output:\n\`\`\`\n${out}\n\`\`\``);
		}
		return md;
	}

	private getIcon(): vscode.ThemeIcon {
		if (this.task.isRunning) {
			return new vscode.ThemeIcon(
				this.task.background ? "server" : "terminal",
				new vscode.ThemeColor("charts.blue"),
			);
		}
		const snap = this.task.snapshot();
		if (snap.aborted) {
			return new vscode.ThemeIcon("x", new vscode.ThemeColor("charts.red"));
		}
		return new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
	}

	private getContextValue(): string {
		const running = this.task.isRunning;
		const fg = !this.task.background;
		if (running && fg) return "shellTaskRunningForeground";
		if (running && !fg) return "shellTaskRunningBackground";
		if (!running && fg) return "shellTaskExitedForeground";
		return "shellTaskExitedBackground";
	}
}

export function registerShellTaskCommands(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("mutsumi.detachShellTask", (item: any) => {
			if (item?.task) {
				item.task.detachToBackground();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("mutsumi.killShellTask", (item: any) => {
			if (item?.task) {
				item.task.abort();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("mutsumi.removeShellTask", (item: any) => {
			if (item?.task) {
				shellTaskRegistry.remove(item.task.id);
			}
		}),
	);
}
