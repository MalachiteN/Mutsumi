/**
 * @fileoverview Global tool result cache for Mutsumi.
 * @module tools.d/cache
 * @description
 * This module provides a global, shared cache for tool execution results.
 * It is used by both:
 * - ToolExecutor (for Agent runtime tool execution)
 * - ToolManager (for pre-execution in context management)
 * 
 * The cache is intentionally global and not tied to any specific Agent,
 * as tool results depend only on the code state, file system, and arguments,
 * not on which Agent is requesting them.
 */

import * as vscode from 'vscode';
import { debugLogger } from '../debugLogger';

/** Global tool result cache Map */
const toolResultCache = new Map<string, string>();

const CACHE_LOG_PREFIX = '[ToolCache]';

/** Event emitter for cache changes */
const _onDidChangeCache = new vscode.EventEmitter<void>();

/**
 * Event that fires when the tool cache is modified or cleared.
 * Use this to listen for cache changes instead of directly importing this module.
 */
export const onDidChangeCache: vscode.Event<void> = _onDidChangeCache.event;

/**
 * Unified logging function for tool cache operations.
 * @param message - The message to log
 */
function cacheLog(message: string): void {
    debugLogger.log(`${CACHE_LOG_PREFIX} ${message}`);
}

/**
 * Generate a cache key from tool name and arguments.
 * @param toolName - Tool name
 * @param args - Tool arguments
 * @returns Cache key string
 */
export function generateCacheKey(toolName: string, args: any): string {
    const key = `${toolName}:${JSON.stringify(args)}`;
    cacheLog(`Generated key: ${key}`);
    return key;
}

/**
 * Clear all cached tool results.
 */
export function clearToolCache(): void {
    cacheLog(`Clearing cache. Previous size: ${toolResultCache.size}`);
    toolResultCache.clear();
    // Fire event to notify listeners (e.g., status bar button)
    _onDidChangeCache.fire();
}

/**
 * Get the number of cached tool results.
 * @returns Cache size
 */
export function getToolCacheSize(): number {
    return toolResultCache.size;
}

/**
 * Log current cache contents for debugging.
 */
export function logCacheContents(): void {
    cacheLog(`Current cache entries (${toolResultCache.size}):`);
    for (const [key, value] of toolResultCache.entries()) {
        cacheLog(`  Key: "${key}" -> Value length: ${value.length}`);
    }
}

/**
 * Check if a result is cached for the given tool and arguments.
 * @param toolName - Tool name
 * @param args - Tool arguments
 * @returns True if result is cached
 */
export function hasCachedResult(toolName: string, args: any): boolean {
    const key = generateCacheKey(toolName, args);
    return toolResultCache.has(key);
}

/**
 * Get cached tool result.
 * @param toolName - Tool name
 * @param args - Tool arguments
 * @returns Cached result, or undefined if not found
 */
export function getCachedResult(toolName: string, args: any): string | undefined {
    const key = generateCacheKey(toolName, args);
    const result = toolResultCache.get(key);
    if (result !== undefined) {
        cacheLog(`CACHE HIT for "${toolName}" - result length: ${result.length}`);
    }
    return result;
}

/**
 * Store tool result in cache.
 * @param toolName - Tool name
 * @param args - Tool arguments
 * @param result - Tool execution result
 */
export function setCachedResult(toolName: string, args: any, result: string): void {
    const key = generateCacheKey(toolName, args);
    toolResultCache.set(key, result);
    cacheLog(`Stored result for "${toolName}" - cache size: ${toolResultCache.size}`);
    // Fire event to notify listeners (e.g., status bar button)
    _onDidChangeCache.fire();
}
