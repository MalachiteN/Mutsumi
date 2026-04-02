# Mutsumi Agent Types

This document describes the Agent Type system as it exists in Mutsumi today.

It is not an RFC for a future architecture. It is a record of the current design after the Agent Type migration was implemented and the earlier adapter-based design was intentionally dropped.

## Design Goals

Mutsumi uses Agent Types to make role behavior explicit without turning the system into a hidden-autonomy framework.

The system is built around these principles:

- explicit over implicit
- inspectable over magical
- user-governed over fully autonomous
- notebook-first where notebook semantics matter
- tool-defined capability boundaries

Agent Types are meant to answer questions like:

- what default model does this role use?
- what rules and skills does it start with?
- what tools can it actually call?
- what child roles may it dispatch?
- can the user create it directly?

They are not meant to answer:

- what transport or UI surface is used?
- whether the user is allowed to inspect or interrupt it?

Those concerns belong elsewhere in the architecture.

## What Agent Types Are

An `AgentType` is a declarative role definition loaded from `.mutsumi/config.json`.

Each type currently defines:

- `toolSets`
- `defaultModel`
- `defaultRules`
- `defaultSkills`
- `allowedChildTypes`
- `isEntry`

That definition is resolved through:

- `src/config/interfaces.ts`
- `src/config/types.ts`
- `src/config/loader.ts`
- `src/config/resolver.ts`
- `src/registry/agentTypeRegistry.ts`
- `src/registry/toolSetRegistry.ts`

## What Agent Types Are Not

### Not Adapters

`AgentType` doesn't contain an adapter field.

This is an intentional architectural design.

In Mutsumi, adapter choice is not role definition. It is execution-carrier semantics:

- `NotebookAdapter`: user-facing notebook session bound to VS Code buffer semantics
- `HeadlessAdapter`: persistent file-backed session for HTTP / remote control
- `LiteAdapter`: in-memory utility session with no UI and no persisted artifact

Adapters answer "how is this session carried?" not "what kind of role is this?"

Current adapter routing rules:

- notebook execution uses `NotebookAdapter`
- HTTP execution uses `HeadlessAdapter`
- dispatched agents inherit the parent execution surface in practice through the creating flow
- `LiteAdapter` is reserved for internal utility work such as title generation and context compression

`LiteAdapter` is intentionally outside the user-facing Agent Type system. It cannot be audited like a notebook or headless session, cannot be corrected mid-flight by the user, and cannot serve as a primary collaborative agent surface in Mutsumi.

### Not Generic State Inheritance

Agent Types do not implement generic inheritance.

This is especially important for `contextItems`.

`contextItems` are not self-sufficient snapshots. They rely on notebook/session history, prior cell structure, and ghost block relationships. Copying them blindly into a new child agent would create a misleading appearance of continuity without the historical substrate that made those items meaningful.

For that reason:

- child rules, skills, and model come from the child `AgentType` defaults unless explicitly overridden
- `allowed_uris` is specified at dispatching time
- `contextItems` are not treated as generically inheritable role state

## Capability Model

In Mutsumi, capability boundaries are defined by tools, not by duplicated booleans.

The important distinction is:

- if a tool is in the agent's resolved tool set, the agent can use it
- if a tool is absent, the agent cannot use it

This avoids parallel truth systems such as `readOnly`, `canShell`, or `canFork` drifting out of sync with the actual tool layer.

Examples:

- a readonly role simply lacks write tools and shell tools
- an orchestrator can have dispatching tools without file-edit tools
- a child agent gains `task_finish` because it is a child session, not because the role definition contains a separate boolean

## Two Control Planes

One subtle but important part of the current architecture is that Mutsumi now has two related but distinct tool planes.

### Agent Runtime Plane

This is the tool surface used by an executing agent.

Resolution flow:

1. read `metadata.agentType`
2. resolve the role through `AgentTypeRegistry`
3. expand named `toolSets` through `ToolSetRegistry`
4. build a per-agent `ToolSet`
5. if the agent is a child agent, inject `task_finish`

This path is used in both:

- `src/controller.ts`
- `src/httpServer/chat.ts`

Both paths now rely on `createToolSetForAgent()` in `src/tools.d/toolManager.ts`.

### User / Context Management Plane

This is the global tool surface used by the user-facing context system.

It is intentionally not scoped to a single `AgentType`.

Examples include:

- syntax completion for tool references
- context pre-execution such as `@[tool{...}]`
- global tool pretty-print and rendering support used by notebook/context infrastructure

This behavior lives in `ToolManager` and belongs to the `ContextManagement` side of the architecture, not to any single agent role.

This distinction is intentional. In Mutsumi, the user is not an external administrator standing outside the system; the user is the highest-authority collaborator in the multi-agent workflow. The context system therefore exposes global tool access for the user's orchestration and inspection tasks, while runtime agents remain constrained by their resolved `AgentType` tool sets.

## Configuration File

Project-level Agent Type configuration lives at:

- `.mutsumi/config.json`

If the file does not exist, Mutsumi loads built-in defaults from `src/config/types.ts` and also bootstraps a default config file into the workspace.

## Current Config Schema

```json
{
    "version": 1,
    "toolSets": {
        "read": [
            "read_file",
            "ls",
            "read_partial_by_range",
            "read_partial_around_keyword",
            "search_file_contains_keyword",
            "search_file_name_includes",
            "get_file_size",
            "get_env_var",
            "system_info",
            "project_outline",
            "get_warning_error",
            "query_codebase"
        ],
        "deliver": [
            "shell",
            "create_or_replace",
            "edit_file_search_replace",
            "mkdir"
        ],
        "dispatch": [
            "dispatch_subagents",
            "get_agent_types"
        ]
    },
    "agentTypes": {
        "chat": {
            "toolSets": [],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/chat.md"],
            "defaultSkills": [],
            "allowedChildTypes": [],
            "isEntry": true
        },
        "implementer": {
            "toolSets": ["read", "deliver", "dispatch"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/implementer.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["implementer", "reviewer"],
            "isEntry": true
        },
        "orchestrator": {
            "toolSets": ["read", "deliver", "dispatch"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/orchestrator.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["planner", "implementer", "reviewer"],
            "isEntry": true
        },
        "planner": {
            "toolSets": ["read", "dispatch"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/planner.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["reviewer"],
            "isEntry": false
        },
        "reviewer": {
            "toolSets": ["read"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/reviewer.md"],
            "defaultSkills": [],
            "allowedChildTypes": [],
            "isEntry": true
        }
    }
}
```

## Field Semantics

### Root

- `version`: config schema version
- `toolSets`: named collections of registered tool names
- `agentTypes`: named role definitions

### `toolSets.<name>`

Each tool set is an array of registered tool names.

Tool sets are composable building blocks, not necessarily full agent roles by themselves. A role may combine multiple tool sets, and the resulting capability surface is the union of their tools.

### `agentTypes.<name>`

- `toolSets`: ordered list of named tool sets to combine
- `defaultModel`: default model for this role
- `defaultRules`: default rule files under `.mutsumi/rules/`
- `defaultSkills`: default active skills
- `allowedChildTypes`: which child roles may be created through `dispatch_subagents`
- `isEntry`: whether the role appears in user-facing creation flows

There is intentionally no:

- `adapter`
- `inherits`
- capability booleans such as `readOnly`, `canShell`, `canFork`

## Runtime Flow

### Extension Startup

At activation time, Mutsumi:

1. initializes `ToolRegistry`
2. loads `.mutsumi/config.json` merged with built-in defaults
3. initializes `ToolSetRegistry`
4. initializes `AgentTypeRegistry`
5. initializes skills and other runtime services

Relevant files:

- `src/extension.ts`
- `src/config/loader.ts`
- `src/config/types.ts`
- `src/registry/toolSetRegistry.ts`
- `src/registry/agentTypeRegistry.ts`

### New Agent Creation from VS Code

`Mutsumi: New Agent` now works as follows:

1. read entry types from `AgentTypeRegistry`
2. show only `isEntry: true` roles in the QuickPick
3. resolve role defaults through `resolveAgentDefaults()`
4. create notebook content with `agentType`, `model`, `activeRules`, and `activeSkills`

Relevant files:

- `src/extension.ts`
- `src/config/resolver.ts`
- `src/notebook/serializer.ts`

### New Agent Creation from HTTP

HTTP agent creation follows the same role model:

1. accept `agentType` from the request body, defaulting to `implementer`
2. validate that the role is an entry type
3. resolve default model/rules/skills
4. write a `.mtm` file whose metadata already contains `agentType`

Relevant file:

- `src/httpServer/agents.ts`

### Notebook and HTTP Execution

Execution now has a strict rule: every real agent must carry a valid `metadata.agentType`.

Notebook path:

- `src/controller.ts`

HTTP path:

- `src/httpServer/chat.ts`

Both paths:

- reject agents with missing `agentType`
- call `createToolSetForAgent(agentType, uuid, parent_agent_id)`
- resolve role tool sets through registries
- inject `task_finish` only when the session is a child agent

This is a significant simplification over the previous main/sub split.

### Forking

Forking remains explicit and role-constrained.

Parent agents can only create child agents whose types appear in `allowedChildTypes`.

The child agent:

- gets its own `agentType`
- gets its own resolved default rules, skills, and model
- receives `allowed_uris` from the dispatch payload
- does not receive generic inherited `contextItems`

Relevant files:

- `src/tools.d/tools/agent_control.ts`
- `src/agent/agentOrchestrator.ts`
- `src/agent/fileOps.ts`

## Metadata Contract

Agent notebook metadata treats `agentType` as the runtime identity anchor for role behavior.

Important persisted fields include:

- `uuid`
- `name`
- `created_at`
- `parent_agent_id`
- `allowed_uris`
- `model`
- `contextItems`
- `activeRules`
- `activeSkills`
- `agentType`

`agentType` is what connects serialized session artifacts to the declarative role registry.

Relevant files:

- `src/types.ts`
- `src/notebook/serializer.ts`
- `src/agent/fileOps.ts`

## Why `task_finish` Is Still Runtime-Injected

`task_finish` is not modeled as a regular role default.

This is intentional.

The tool does not represent a stable persona capability like read, write, or fork. It represents a parent/child lifecycle obligation. A role becomes responsible for `task_finish` only when it is actually executing as a child agent.

That is why `createToolSetForAgent()` injects `task_finish` based on `parent_agent_id` rather than storing it in normal `toolSets`.

## Why `ToolManager` Still Exists

`ToolManager` survives the Agent Type migration because it serves the user/context control plane rather than the runtime agent plane.

It is used for infrastructure concerns such as:

- tool reference completion
- tool pre-execution in context expansion
- global pretty-print and rendering support

This is not a backdoor around Agent Types. It is the control surface the user and context system use to work with tools outside the bounded execution of any single runtime agent.

Relevant files:

- `src/tools.d/toolManager.ts`
- `src/notebook/completionProvider.ts`
- `src/contextManagement/utils.ts`
- `src/notebook/serializer.ts`

## LiteAdapter Status

`LiteAdapter` remains part of the codebase, but it is no longer part of the Agent Type design surface.

Its role is intentionally narrow:

- title generation
- context compression
- internal utility work that does not need persistent, inspectable, user-interruptible execution

It should not be treated as a first-class user-facing agent carrier.

## Modules That Matter Now

The current Agent Type system mainly lives in these modules.

### Configuration and Resolution

- `src/config/interfaces.ts`
- `src/config/types.ts`
- `src/config/loader.ts`
- `src/config/utils.ts`
- `src/config/resolver.ts`

### Registries

- `src/registry/agentTypeRegistry.ts`
- `src/registry/toolSetRegistry.ts`

### Execution

- `src/tools.d/toolManager.ts`
- `src/controller.ts`
- `src/httpServer/chat.ts`
- `src/agent/agentRunner.ts`

### Creation and Serialization

- `src/notebook/serializer.ts`
- `src/agent/fileOps.ts`
- `src/httpServer/agents.ts`
- `src/extension.ts`

### Fork and Orchestration

- `src/tools.d/tools/agent_control.ts`
- `src/agent/agentOrchestrator.ts`

### Context / User Control Plane

- `src/contextManagement/utils.ts`
- `src/notebook/completionProvider.ts`

## Practical Summary

Mutsumi's current model is:

- `AgentType` defines role defaults and capability composition
- `ToolSet` defines runtime capability boundaries
- adapters define session carriers, not roles
- child completion semantics are runtime lifecycle behavior, not role metadata
- `ToolManager` belongs to the user/context control plane, not to any single runtime agent

This preserves Mutsumi's philosophy:

- explicit role identity
- explicit capability boundaries
- auditable primary agent sessions
- strong user control
- no hidden inheritance magic
