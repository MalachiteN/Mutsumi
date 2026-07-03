import type { ITool, ToolContext } from "../interface";
import { resolveUri, COMMON_IGNORE_GLOBS, withAbortableToken } from "../utils";
import * as vscode from "vscode";
import { TextDecoder } from "util";

const MAX_FILES_TO_GREP = 1000;

export const searchFileContainsKeywordTool: ITool = {
	name: "search_file_contains_keyword",
	definition: {
		type: "function",
		function: {
			name: "search_file_contains_keyword",
			description:
				"Search for a keyword in files. Returns file paths and line numbers. Equivalent to `grep -rn keyword uri`.",
			parameters: {
				type: "object",
				properties: {
					uri: {
						type: "string",
						description: "The directory URI to start search.",
					},
					keyword: {
						type: "string",
						description: "The keyword to search for.",
					},
				},
				required: ["uri", "keyword"],
			},
		},
	},
	execute: async (args: any, context: ToolContext) => {
		try {
			const { uri: uriInput, keyword } = args;
			if (!uriInput || !keyword) return "Error: Missing arguments.";

			const rootUri = resolveUri(uriInput);
			const relativePattern = new vscode.RelativePattern(rootUri, "**/*");
			const exclude = COMMON_IGNORE_GLOBS;
			const abortSignal = context.toolSession.abortSignal;

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
			} catch {
				return `[Interrupted] The search_file_contains_keyword tool execution was forcibly stopped by the user.`;
			}
			if (abortSignal.aborted) {
				return `[Interrupted] The search_file_contains_keyword tool execution was forcibly stopped by the user.`;
			}

			if (files.length === 0) return "No files found in directory.";

			const lines: string[] = [];
			for (const fileUri of files) {
				if (abortSignal.aborted) {
					return `[Interrupted] The search_file_contains_keyword tool execution was forcibly stopped by the user.`;
				}
				try {
					const bytes = await vscode.workspace.fs.readFile(fileUri);
					const content = new TextDecoder().decode(bytes);
					if (content.includes("\0")) continue;
					const fileLines = content.split(/\r?\n/);
					for (let idx = 0; idx < fileLines.length; idx++) {
						const line = fileLines[idx];
						if (line.includes(keyword)) {
							const relPath = fileUri.toString().startsWith(rootUri.toString())
								? fileUri.toString().substring(rootUri.toString().length)
								: vscode.workspace.asRelativePath(fileUri);
							const displayPath = relPath.startsWith("/")
								? relPath.substring(1)
								: relPath;
							const displayLine =
								line.length > 300 ? line.substring(0, 300) + "..." : line;
							lines.push(`${displayPath}:${idx + 1}:${displayLine.trim()}`);
						}
					}
				} catch {
					/* ignore */
				}
			}

			return lines.join("\n") || "No matches found.";
		} catch (err: any) {
			return `Error performing search: ${err.message}`;
		}
	},
	prettyPrint: (args: any) => {
		return `🔍 Mutsumi grepped "${args.keyword || "(unknown)"}" in ${args.uri || "(unknown directory)"}`;
	},
};

export const searchFileNameIncludesTool: ITool = {
	name: "search_file_name_includes",
	definition: {
		type: "function",
		function: {
			name: "search_file_name_includes",
			description:
				'Find files whose names include the specified string. Equivalent to `find uri -name "*name_includes*"`.',
			parameters: {
				type: "object",
				properties: {
					uri: {
						type: "string",
						description: "The directory URI to start search.",
					},
					name_includes: {
						type: "string",
						description: "The string that filenames must contain.",
					},
				},
				required: ["uri", "name_includes"],
			},
		},
	},
	execute: async (args: any, context: ToolContext) => {
		try {
			const { uri: uriInput, name_includes } = args;
			if (!uriInput || !name_includes) return "Error: Missing arguments.";

			const rootUri = resolveUri(uriInput);
			const pattern = `**/*${name_includes}*`;
			const relativePattern = new vscode.RelativePattern(rootUri, pattern);
			const exclude = COMMON_IGNORE_GLOBS;
			const abortSignal = context.toolSession.abortSignal;

			let files: vscode.Uri[];
			try {
				files = await withAbortableToken(abortSignal, (token) =>
					vscode.workspace.findFiles(relativePattern, exclude, 200, token),
				);
			} catch {
				return `[Interrupted] The search_file_name_includes tool execution was forcibly stopped by the user.`;
			}
			if (abortSignal.aborted) {
				return `[Interrupted] The search_file_name_includes tool execution was forcibly stopped by the user.`;
			}

			if (files.length === 0) return "No files found.";

			return files
				.map((uri) => {
					return uri.toString().startsWith(rootUri.toString())
						? uri
								.toString()
								.substring(
									rootUri.toString().length +
										(rootUri.toString().endsWith("/") ? 0 : 1),
								)
						: vscode.workspace.asRelativePath(uri);
				})
				.join("\n");
		} catch (err: any) {
			return `Error searching filenames: ${err.message}`;
		}
	},
	prettyPrint: (args: any) => {
		return `🔍 Mutsumi searched files named "*${args.name_includes || "(unknown)*"}*" in ${args.uri || "(unknown directory)"}`;
	},
};
