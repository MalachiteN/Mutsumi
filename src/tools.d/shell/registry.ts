import * as vscode from "vscode";
import type { ShellTask } from "./shellTask";

class ShellTaskRegistry {
	private tasks = new Map<string, ShellTask>();
	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	register(t: ShellTask): void {
		this.tasks.set(t.id, t);
		t.onExit(() => this._onDidChange.fire());
		this._onDidChange.fire();
	}
	get(id: string): ShellTask | undefined {
		return this.tasks.get(id);
	}
	remove(id: string): ShellTask | undefined {
		const t = this.tasks.get(id);
		if (t) {
			this.tasks.delete(id);
			this._onDidChange.fire();
		}
		return t;
	}
	getAll(): ShellTask[] {
		return [...this.tasks.values()];
	}
}

export const shellTaskRegistry = new ShellTaskRegistry();
