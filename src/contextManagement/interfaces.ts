/**
 * @fileoverview Structured ghost block domain interfaces.
 * @module contextManagement/interfaces
 */

/**
 * File entry persisted in a structured ghost block.
 *
 * A ghost file entry represents the file portion of one historical
 * `<content_reference>` block. It stores the final rendered content that was
 * shown to the model, not raw disk bytes.
 */
export interface GhostFileEntry {
    /** Workspace-relative reference key, same as ContextItem.key (for example "src/foo.ts"). */
    key: string;

    /**
     * Differential version assigned by history.ts.
     * Versions start at 1 and increment only when the rendered file content hash changes.
     */
    version: number;

    /**
     * Rendered file content projection state:
     * - string: this ghost block carried the full rendered file content;
     * - null: this ghost block carried only a "content unchanged, see previous version" reference.
     */
    content: string | null;
}

/**
 * Tool entry persisted in a structured ghost block.
 *
 * Tools are not differentially updated: each entry replays exactly one
 * pre-executed tool result in ghost block order.
 */
export interface GhostToolEntry {
    /** Tool name, same as ContextItem.key. */
    key: string;

    /**
     * Exact text rendered after "> Args: ".
     * For successful calls this is JSON.stringify(args); for failed template
     * parsing/execution it may be the original bracket content used as metadata.
     */
    argsText: string;

    /** Exact tool output or error text rendered in the ghost block body. */
    content: string;
}

/**
 * Canonical persisted representation of a cell ghost block.
 *
 * This object is the only source of truth for ghost block logic. The markdown
 * `<content_reference>` string is a provider-facing projection produced from
 * this structure at message assembly time; it is not persisted and is not used
 * for differential decisions.
 */
export interface GhostBlock {
    /** File entries in render order. Reference-only entries use content: null. */
    files: GhostFileEntry[];

    /** Tool entries in render order. */
    tools: GhostToolEntry[];
}
