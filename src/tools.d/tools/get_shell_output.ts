import type { ITool } from '../interface';
import { shellTaskRegistry } from '../shell/registry';
import { formatShellOutput } from '../shell/shellTask';

export const getShellOutputTool: ITool = {
    name: 'get_shell_output',
    definition: {
        type: 'function',
        function: {
            name: 'get_shell_output',
            description: 'Inspect the output of a background shell task. If the task is still running, returns the current full stdout/stderr without removing the task. If the task has exited, returns the full output plus exit info and removes the task (consumes it).',
            parameters: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'The task id returned by a background shell call.' }
                },
                required: ['task_id']
            }
        }
    },
    execute: async (args: any) => {
        const id = args.task_id;
        if (!id) return 'Error: Missing "task_id" argument.';
        const task = shellTaskRegistry.get(id);
        if (!task) return `Error: No background shell task with id "${id}".`;

        const snap = task.snapshot();
        const parts: string[] = [];
        if (snap.running) {
            parts.push(`[Task ${id} still running — snapshot, task not removed]`);
        }
        parts.push(formatShellOutput(snap, { showExit: false }));

        if (!snap.running) {
            shellTaskRegistry.remove(id);
        }
        return parts.join('\n\n').trim() || '(no output yet)';
    },
    prettyPrint: (args: any) => `📄 Mutsumi inspected shell task ${args.task_id || '(unknown)'}`,
    shouldCache: false
};
