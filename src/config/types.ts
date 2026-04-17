/**
 * @fileoverview Configuration types and built-in defaults for Mutsumi.
 * 
 * This file contains only:
 * - Built-in default configuration (DEFAULT_MUTSUMI_CONFIG)
 * - Re-exports from interfaces.ts
 * 
 * For validation utilities, see utils.ts.
 * 
 * @module config/types
 */

import {
    MutsumiConfig,
    AgentTypeConfig,
    ToolSetsConfig
} from './interfaces';

// Re-export all interfaces
export {
    MutsumiConfig,
    AgentTypeConfig,
    ToolSetsConfig,
    ToolSetName,
    ToolSetDefinition,
    AgentTypeConfigMap,
    ResolvedAgentDefaults,
    ResolveAgentDefaultsOptions
} from './interfaces';

// Re-export validation utilities from utils.ts
export {
    ConfigValidationError,
    validateMutsumiConfig
} from './utils';

/**
 * Built-in default configuration.
 * Used when .mutsumi/config.json does not exist.
 * 
 * Base tool sets:
 * - read: File reading, search, and info tools (read-only)
 * - deliver: File writing, editing, shell execution (write operations)
 * - dispatch: Agent orchestration tools (dispatch_subagents, get_agent_types)
 */
export const DEFAULT_MUTSUMI_CONFIG: MutsumiConfig = {
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
            "defaultModel": "kimi-for-coding",
            "defaultRules": ["default/chat.md"],
            "defaultSkills": [],
            "allowedChildTypes": [],
            "isEntry": true
        },
        "implementer": {
            "toolSets": ["read", "deliver", "dispatch"],
            "defaultModel": "kimi-for-coding",
            "defaultRules": ["default/implementer.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["implementer", "reviewer"],
            "isEntry": true
        },
        "orchestrator": {
            "toolSets": ["read", "deliver", "dispatch"],
            "defaultModel": "kimi-for-coding",
            "defaultRules": ["default/orchestrator.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["planner", "implementer", "reviewer"],
            "isEntry": true
        },
        "planner": {
            "toolSets": ["read", "dispatch"],
            "defaultModel": "kimi-for-coding",
            "defaultRules": ["default/planner.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["reviewer"],
            "isEntry": false
        },
        "reviewer": {
            "toolSets": ["read"],
            "defaultModel": "kimi-for-coding",
            "defaultRules": ["default/reviewer.md"],
            "defaultSkills": [],
            "allowedChildTypes": [],
            "isEntry": true
        }
    }
};
