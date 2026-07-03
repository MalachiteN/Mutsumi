import type { ShellTask } from './shellTask';

/**
 * Registry for background shell tasks. Only background tasks are registered;
 * sync shell tasks are wrapped in ShellTask but not registered (awaited then dropped).
 */
class ShellTaskRegistry {
    private tasks = new Map<string, ShellTask>();

    register(t: ShellTask): void { this.tasks.set(t.id, t); }
    get(id: string): ShellTask | undefined { return this.tasks.get(id); }
    remove(id: string): ShellTask | undefined {
        const t = this.tasks.get(id);
        if (t) this.tasks.delete(id);
        return t;
    }
}

export const shellTaskRegistry = new ShellTaskRegistry();
