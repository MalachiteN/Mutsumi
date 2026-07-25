Before you act, evaluate whether the task should be split into parallel sub-agents. Forking is a means, not a goal.

@[get_agent_types{"current_agent_type": "<!-- @echo ROLE -->"}]

## When to Consider `dispatch_subagents`

Consider dispatching sub-agents when all of the following hold:

- The work is large enough to decompose into clearly separable pieces.
- The pieces can be defined with weak coupling and minimal ongoing cross-context.
- Parallel execution would materially improve throughput, quality, or isolation.
- You can still integrate and judge the results yourself.

## When to Handle the Task Yourself

Do not fork when any of the following apply:

- The task is small enough to complete cleanly in your own context.
- The changes belong to the same module and must keep a consistent design.
- The work spans multiple modules but must be coordinated as one integrated change.
- The task cannot be cleanly decomposed into independent sub-tasks.
- The sub-tasks require continuous shared context or tight iteration.
- You are trying to escape responsibility for a difficult assignment.

When in doubt, complete the work yourself and report upward rather than forking prematurely.

## Querying Allowed Child Types

Before calling `dispatch_subagents`, confirm the child types available to your current role.

The pre-executed block above already shows them. If it is missing, call `get_agent_types` with your `current_agent_type`.

## Constructing Sub-Agent Prompts

Use `context_broadcast` for information every sub-agent needs. Put agent-specific instructions only in that agent's `prompt`.

### What belongs in `context_broadcast`

- The overall task goal and final target state.
- The partition of work across sub-agents: who owns which files or modules.
- Shared constraints: style rules, forbidden areas, test requirements, interface contracts.
- Files or documents every sub-agent must read, referenced with `@[path]` so they are injected directly into each child context.
- The expected format for `task_finish` reports.

### What belongs in each `sub_agents[i].prompt`

- The precise task this sub-agent must complete.
- The exact files it may read or edit.
- Its deliverables and acceptance criteria.
- Its dependency on sibling agents, if any.
- Any role-specific behavior it must follow.

### Why the split matters

If everything goes into `prompt`, you waste tokens and each agent may miss the global picture. If everything goes into `broadcast`, agents will not know what they personally own. Keep shared context in one place and per-agent scope in the other.

### Referencing files for sub-agents

This system supports file injection through pre-execution. When a sub-agent must read a file, prefer to wrap it with `@[path/to/file]` inside the `context_broadcast` or the per-agent `prompt`. This inserts the file content directly into the child context and reduces the tokens wasted on the child deciding which tools to call and re-reading history.

### Informing sub-agents about each other

Every sub-agent must know that the other sub-agents exist, what each is responsible for, and which files each may touch. This prevents them from making assumptions that cross into another agent's scope. Put this overview in `context_broadcast`.

## Integration Responsibility

If you fork, you remain responsible for integrating and judging the child results. Do not forward child outputs upward without interpretation. A child agent's `task_finish` report is input for your synthesis, not a finished deliverable.
