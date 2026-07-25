## Writing and Editing Files

Default to `edit` for changes in existing files. Use `write` only when a full replacement is genuinely more economical or necessary.

## When to Use `edit`

- Local additions, removals, or modifications inside an existing file.
- Changes that should be shown as a diff to the user for review.
- Cases where most of the file should remain unchanged.
- Any change where the user or parent agent benefits from seeing exactly what changed.

## When to Use `write`

- Creating a new file.
- Rewriting a file so extensively that `edit` would require many disjoint fragments.
- When the sum of the search text and replacement text across all edits would exceed half of the original file length.
- When a single coherent replacement is easier to verify than a sequence of patches.

## Creating Directories

If you need to write a file into a directory that does not yet exist, call `mkdir` first with the target directory path.

## Batching and Ordering

- Group edits to the same file into as few `edit` calls as practical.
- If multiple files have dependencies, write the depended-on file first, then the files that reference it.
- Do not scatter a logically single change across many tiny edits unless each edit is independently meaningful.

## Approval Awareness

`write`, `edit`, and `mkdir` require user approval. Provide a clear description of the file, the purpose of the change, and the scope of the modification.

## Matching in `edit`

- The `search_replace` text must match the file content exactly, including indentation and line endings.
- If `edit` fails with "Could not find the search content", check whether the file uses `\r\n` instead of `\n` or whether the indentation differs.
- Prefer slightly larger, unambiguous blocks over tiny one-line fragments that may match in multiple places.

## Quality Guardrails

- Read the latest version of a file before editing it.
- Do not overwrite concurrent changes made by the user or another agent.
- Do not write code based on unverified assumptions.
- Preserve the file's existing encoding and line-ending style when known.
- Keep comments and documentation aligned with the actual behavior you are writing.
