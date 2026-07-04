import * as vscode from "vscode";
import { ShellTaskTreeItem } from "./shellTaskTreeItem";
import { shellTaskRegistry } from "../tools.d/shell/registry";

export type ShellTaskSidebarItem = ShellTaskTreeItem;

export class ShellTaskTreeDataProvider
	implements vscode.TreeDataProvider<ShellTaskSidebarItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		ShellTaskSidebarItem | undefined | null
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private timer: NodeJS.Timeout | undefined;

	constructor() {
		shellTaskRegistry.onDidChange(() => {
			this.refresh();
			this.updateTicker();
		});
		this.updateTicker();
	}

	private updateTicker(): void {
		const hasRunning = shellTaskRegistry.getAll().some((t) => t.isRunning);
		if (hasRunning && !this.timer) {
			this.timer = setInterval(() => this.refresh(), 1000);
		} else if (!hasRunning && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	getTreeItem(element: ShellTaskSidebarItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: ShellTaskSidebarItem,
	): Thenable<ShellTaskSidebarItem[]> {
		if (element) {
			return Promise.resolve([]);
		}
		const tasks = shellTaskRegistry.getAll();
		tasks.sort((a, b) => {
			if (a.isRunning && !b.isRunning) return -1;
			if (!a.isRunning && b.isRunning) return 1;
			return b.createdAt - a.createdAt;
		});
		return Promise.resolve(tasks.map((t) => new ShellTaskTreeItem(t)));
	}

	public refresh(): void {
		this._onDidChangeTreeData.fire(null);
	}
}
