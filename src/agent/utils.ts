/**
 * @fileoverview Utility helper functions for the agent.
 * @module agent/utils
 */

import { parse, Allow } from "partial-json";

/** Allow partial strings/numbers (scalar streaming) and objects (nested). */
const PARTIAL_ALLOW = Allow.STR | Allow.NUM | Allow.OBJ;

/**
 * Best-effort parse of a potentially incomplete JSON string.
 *
 * Used to render tool-call arguments while streaming. Returns a partial object
 * that grows monotonically instead of collapsing back, so the rendered output
 * does not flicker as characters arrive.
 *
 * @param {string} input - The raw JSON string
 * @returns {any} The parsed value, or a best-effort partial object
 */
export function tryParsePartialJson(input: string): any {
	if (!input) {
		return {};
	}

	// Fast path: the JSON is already complete and valid.
	try {
		return JSON.parse(input);
	} catch (e) {
		// Fall through to best-effort partial parsing.
	}

	try {
		return parse(input, PARTIAL_ALLOW);
	} catch (e) {
		// Malformed or empty: degrade to an empty object so the tool name can
		// still be rendered.
		return {};
	}
}
