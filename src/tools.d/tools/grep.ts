import type { ITool, ToolContext } from "../interface";
import { resolveUri, COMMON_IGNORE_GLOBS, withAbortableToken } from "../utils";
import * as vscode from "vscode";
import { TextDecoder } from "util";

const MAX_FILES_TO_GREP = 1000;

export const grepTool: ITool = {
	name: "grep",
	definition: {
		type: "function",
		function: {
			name: "grep",
			description:
				'Search for a keyword in a file or directory. Accepts both file and directory URIs — for directories, recursively searches all files (ignoring common patterns, skipping binary files, truncating long lines); for files, returns matching lines with optional context. Output format: "path:line:content".',
			parameters: {
				type: "object",
				properties: {
					uri: {
						type: "string",
						description:
							"The file or directory URI to search in.",
					},
					keyword: {
						type: "string",
						description: "The keyword to search for.",
					},
					lines_before: {
						type: "integer",
						description:
							"Number of context lines before each match (file mode only, default 0).",
					},
					lines_after: {
						type: "integer",
						description:
							"Number of context lines after each match (file mode only, default 0).",
					},
				},
				required: ["uri", "keyword"],
			},
		},
	},
	execute: async (args: any, context: ToolContext) => {
		const abortSignal = context.toolSession.abortSignal;
		try {
			const { uri: uriInput, keyword } = args;
			if (!uriInput || !keyword)
				return "Error: Missing arguments (uri, keyword).";

			const linesBefore =
				typeof args.lines_before === "number" ? args.lines_before : 0;
			const linesAfter =
				typeof args.lines_after === "number" ? args.lines_after : 0;

			const rootUri = resolveUri(uriInput);

			// Determine whether uri is a file or directory
			let stat: vscode.FileStat;
			try {
				stat = await vscode.workspace.fs.stat(rootUri);
			} catch (err: any) {
				if (abortSignal.aborted) {
					return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
				}
				return `Error: Cannot access path "${uriInput}": ${err?.message ?? String(err)}`;
			}

			if (stat.type === vscode.FileType.Directory) {
				return await searchDirectory(rootUri, keyword, abortSignal);
			} else {
				return await searchFile(
					rootUri,
					keyword,
					linesBefore,
					linesAfter,
					abortSignal,
				);
			}
		} catch (err: any) {
			if (abortSignal.aborted) {
				return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
			}
			return `Error performing search: ${err.message}`;
		}
	},
	prettyPrint: (args: any) => {
		return `🔍 Mutsumi grepped "${args.keyword || "(unknown)"}" in ${args.uri || "(unknown path)"}`;
	},
};

/**
 * Recursive directory search — mirrors the behaviour of the former directory
 * search tool: ignore COMMON_IGNORE_GLOBS, cap result files, skip binary
 * files, truncate long lines.  Output: `path:line:content`.
 */
async function searchDirectory(
	rootUri: vscode.Uri,
	keyword: string,
	abortSignal: AbortSignal,
): Promise<string> {
	const relativePattern = new vscode.RelativePattern(rootUri, "**/*");
	const exclude = COMMON_IGNORE_GLOBS;

	let files: vscode.Uri[];
	try {
		files = await withAbortableToken(abortSignal, (token) =>
			vscode.workspace.findFiles(
				relativePattern,
				exclude,
				MAX_FILES_TO_GREP,
				token,
			),
		);
	} catch (err: any) {
		if (abortSignal.aborted) {
			return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
		}
		return `Error searching directory: ${err?.message ?? String(err)}`;
	}
	if (abortSignal.aborted) {
		return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
	}

	if (files.length === 0) return "No files found in directory.";

	const lines: string[] = [];
	for (const fileUri of files) {
		if (abortSignal.aborted) {
			return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
		}
		try {
			const bytes = await vscode.workspace.fs.readFile(fileUri);
			const content = new TextDecoder().decode(bytes);
			if (content.includes("\0")) continue; // skip binary
			const fileLines = content.split(/\r?\n/);
			const relPath = fileUri
				.toString()
				.startsWith(rootUri.toString())
				? fileUri.toString().substring(rootUri.toString().length)
				: vscode.workspace.asRelativePath(fileUri);
			const displayPath = relPath.startsWith("/")
				? relPath.substring(1)
				: relPath;
			for (let idx = 0; idx < fileLines.length; idx++) {
				const line = fileLines[idx];
				if (line.includes(keyword)) {
					const displayLine =
						line.length > 300
							? line.substring(0, 300) + "..."
							: line;
					lines.push(`${displayPath}:${idx + 1}:${displayLine.trim()}`);
				}
			}
		} catch {
			/* ignore individual file errors */
		}
	}

	return lines.join("\n") || "No matches found.";
}

/**
 * Single-file search with context lines — mirrors the behaviour of the
 * former file-context search tool: merge overlapping context regions,
 * separate non-adjacent regions with `...`.
 * Output: `path:line:content`.
 */
async function searchFile(
	uri: vscode.Uri,
	keyword: string,
	linesBefore: number,
	linesAfter: number,
	abortSignal: AbortSignal,
): Promise<string> {
	let content: string;
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		content = new TextDecoder().decode(bytes);
	} catch (err: any) {
		if (abortSignal.aborted) {
			return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
		}
		return `Error reading file: ${err.message}`;
	}

	if (content.includes("\0")) return "Binary file — cannot search.";

	const fileLines = content.split(/\r?\n/);
	const lineCount = fileLines.length;

	const indicesToKeep = new Set<number>();

	for (let i = 0; i < lineCount; i++) {
		if (abortSignal.aborted) {
			return "[Interrupted] The grep tool execution was forcibly stopped by the user.";
		}
		if (fileLines[i].includes(keyword)) {
			const start = Math.max(0, i - linesBefore);
			const end = Math.min(lineCount - 1, i + linesAfter);
			for (let j = start; j <= end; j++) {
				indicesToKeep.add(j);
			}
		}
	}

	if (indicesToKeep.size === 0)
		return `No matches found for "${keyword}".`;

	const sortedIndices = Array.from(indicesToKeep).sort((x, y) => x - y);
	const relPath = vscode.workspace.asRelativePath(uri);

	let result = "";
	let prevIndex = -1;

	for (const idx of sortedIndices) {
		if (prevIndex !== -1 && idx > prevIndex + 1) {
			result += "...\n";
		}
		result += `${relPath}:${idx + 1}:${fileLines[idx]}\n`;
		prevIndex = idx;
	}

	return result.trim();
}
