import type * as cp from 'child_process';
import { v4 as uuidv4 } from 'uuid';

/**
 * A single tool execution session. Created per tool call by ToolExecutor.
 * Holds the AbortController whose signal is the one tools should listen to.
 * Tools may attach long-running resources (shell child) for cleanup on abort.
 */
export class ToolSession {
    readonly id: string;
    readonly agentSessionId: string;
    readonly toolName: string;
    readonly abortController = new AbortController();
    private status: 'running' | 'completed' | 'aborted' = 'running';
    private cleanups: Array<() => void> = [];

    constructor(agentSessionId: string, toolName: string) {
        this.id = uuidv4();
        this.agentSessionId = agentSessionId;
        this.toolName = toolName;
    }

    get abortSignal(): AbortSignal { return this.abortController.signal; }
    get isAborted(): boolean { return this.status === 'aborted'; }

    attachChild(c: cp.ChildProcess): void {
        this.cleanups.push(() => { try { c.kill('SIGTERM'); } catch { /* ignore */ } });
    }

    onCleanup(fn: () => void): void {
        this.cleanups.push(fn);
    }

    abort(): void {
        if (this.status !== 'running') return;
        this.status = 'aborted';
        try { this.abortController.abort(); } catch { /* ignore */ }
        this.cleanups.forEach(fn => { try { fn(); } catch { /* ignore */ } });
    }

    complete(): void {
        if (this.status !== 'running') return;
        this.status = 'completed';
    }
}
