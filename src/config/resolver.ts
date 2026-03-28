/**
 * @fileoverview Agent configuration resolver for centralized default value resolution.
 * @module config/resolver
 */

import * as vscode from 'vscode';
import { AgentTypeRegistry } from '../registry/agentTypeRegistry';
import { ResolvedAgentDefaults, ResolveAgentDefaultsOptions } from './interfaces';

export { ResolvedAgentDefaults, ResolveAgentDefaultsOptions } from './interfaces';

/**
 * Resolves agent defaults from AgentTypeRegistry with optional overrides.
 * 
 * This is the central function for resolving agent configuration defaults.
 * Priority: overrides > agent type defaults > VS Code config defaultModel
 * 
 * @param {string} agentType - The agent type identifier (e.g., 'implementer', 'sub')
 * @param {ResolveAgentDefaultsOptions} [options] - Optional overrides and filters
 * @returns {ResolvedAgentDefaults} The resolved configuration with all defaults applied
 * @throws {Error} If agentType is not found in registry
 * 
 * @example
 * // Basic usage - resolve defaults for 'implementer' type
 * const defaults = resolveAgentDefaults('implementer');
 * 
 * @example
 * // With overrides and filtering
 * const defaults = resolveAgentDefaults('implementer', {
 *     model: 'gpt-4',
 *     availableRules: ['default.md', 'custom.md']
 * });
 */
export function resolveAgentDefaults(
    agentType: string,
    options?: ResolveAgentDefaultsOptions
): ResolvedAgentDefaults {
    const typeConfig = AgentTypeRegistry.getInstance().getAgentType(agentType);
    
    if (!typeConfig) {
        throw new Error(
            `Unknown agent type '${agentType}'. ` +
            `Available types: ${AgentTypeRegistry.getInstance().getAllTypes().join(', ')}`
        );
    }

    // Resolve model: override > agent type default > VS Code config
    const vscodeDefaultModel = vscode.workspace.getConfiguration('mutsumi').get<string>('defaultModel');
    const resolvedModel = options?.model 
        ?? typeConfig.defaultModel 
        ?? vscodeDefaultModel 
        ?? 'moonshotai/kimi-k2.5';

    // Resolve rules: override > agent type default
    let resolvedRules: string[];
    if (options?.rules !== undefined) {
        resolvedRules = options.rules;
    } else {
        resolvedRules = typeConfig.defaultRules ?? [];
    }

    // Filter rules to only include existing ones if availableRules provided
    if (options?.availableRules !== undefined && resolvedRules.length > 0) {
        resolvedRules = resolvedRules.filter(r => options.availableRules!.includes(r));
    }

    // Resolve skills: override > agent type default
    const resolvedSkills = options?.skills !== undefined
        ? options.skills
        : (typeConfig.defaultSkills ?? []);

    return {
        model: resolvedModel,
        rules: resolvedRules,
        skills: resolvedSkills,
        toolSets: typeConfig.toolSets
    };
}

/**
 * Validates if an agent type is a valid entry type.
 * Entry types are those that can be created directly by users.
 * 
 * @param {string} agentType - The agent type to validate
 * @returns {{ valid: boolean; error?: string }} Validation result with optional error message
 * 
 * @example
 * const result = validateEntryAgentType('implementer');
 * if (!result.valid) {
 *     console.error(result.error);
 * }
 */
export function validateEntryAgentType(agentType: string): { valid: boolean; error?: string } {
    let typeConfig;
    try {
        typeConfig = AgentTypeRegistry.getInstance().getAgentType(agentType);
    } catch (e) {
        return { 
            valid: false, 
            error: `Agent type registry not initialized: ${e}` 
        };
    }

    if (!typeConfig) {
        return { 
            valid: false, 
            error: `Unknown agent type: '${agentType}'` 
        };
    }

    if (!typeConfig.isEntry) {
        return { 
            valid: false, 
            error: `Agent type '${agentType}' is not an entry type and cannot be created directly.` 
        };
    }

    return { valid: true };
}

/**
 * Gets a list of all available entry agent types with their configurations.
 * Useful for UI components that need to display agent type selection options.
 * 
 * @returns {Array<{ name: string; config: import('../registry/agentTypeRegistry').AgentTypeConfig }>} 
 *          Array of entry type names and their configurations
 * 
 * @example
 * const entryTypes = getEntryAgentTypes();
 * for (const { name, config } of entryTypes) {
 *     console.log(`${name}: ${config.toolSets.join(', ')} tool sets`);
 * }
 */
export function getEntryAgentTypes(): Array<{ 
    name: string; 
    config: import('../config/interfaces').AgentTypeConfig 
}> {
    try {
        const registry = AgentTypeRegistry.getInstance();
        const entryTypeNames = registry.listEntryTypes();
        
        return entryTypeNames.map(name => {
            const config = registry.getAgentType(name)!;
            return { name, config };
        });
    } catch (e) {
        console.warn('[getEntryAgentTypes] Failed to get entry types:', e);
        return [];
    }
}
