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
 * - fork: Agent orchestration tools (self_fork, get_agent_types)
 */
export const DEFAULT_MUTSUMI_CONFIG: MutsumiConfig = {
    "version": 1,
    "toolSets": {
        "read": [
            "read_file",
            "ls",
            "partially_read_by_range",
            "partially_read_around_keyword",
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
            "edit_file_full_replace",
            "edit_file_search_replace",
            "mkdir",
            "create_file"
        ],
        "fork": [
            "self_fork",
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
            "toolSets": ["read", "deliver", "fork"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/implementer.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["implementer", "reviewer"],
            "isEntry": true
        },
        "orchestrator": {
            "toolSets": ["read", "fork"],
            "defaultModel": "moonshotai/kimi-k2.5",
            "defaultRules": ["default/orchestrator.md"],
            "defaultSkills": [],
            "allowedChildTypes": ["planner", "implementer", "reviewer"],
            "isEntry": true
        },
        "planner": {
            "toolSets": ["read", "fork"],
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
};
