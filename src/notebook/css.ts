/**
 * @fileoverview CSS styles for the Mutsumi agent chat notebook renderer.
 * Extracted from renderer.ts for maintainability.
 * Imported by renderer.ts and injected as a <style> element at activation time.
 * @module notebook/css
 */

export const RENDERER_CSS = `
/* Mutsumi Agent Chat Renderer Styles */

.mutsumi-committed, .mutsumi-active {
  width: 100%;
}

.mutsumi-block {
  margin: 4px 0;
}

/* Themed container replacement for tool calls and reasoning */
.mutsumi-block > details {
  background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(128, 128, 128, 0.15));
  padding: 12px 16px;
  border-radius: 8px;
  margin: 8px 0;
  width: fit-content;
  max-width: 90%;
}

.mutsumi-block > details > summary {
  cursor: pointer;
  font-weight: 500;
  user-select: none;
}

.mutsumi-tool-args {
  margin-top: 8px;
}

.mutsumi-tool-args ul {
  list-style: none;
  padding-left: 0;
}

.mutsumi-tool-args li {
  margin: 2px 0;
}

.mutsumi-tool-args pre,
.mutsumi-block > details > pre {
  background-color: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
  padding: 8px 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}

.mutsumi-tool-args code,
.mutsumi-block > details > pre code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-editor-font-size, 13px);
}

.mutsumi-reasoning-content {
  margin-top: 8px;
  opacity: 0.85;
}

/* Content blocks: render markdown output */
.mutsumi-block > :not(details) p {
  margin: 8px 0;
}

.mutsumi-block > :not(details) pre {
  background-color: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

.mutsumi-block > :not(details) code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-editor-font-size, 13px);
}

.mutsumi-block > :not(details) table {
  border-collapse: collapse;
  width: 100%;
}

.mutsumi-block > :not(details) th,
.mutsumi-block > :not(details) td {
  border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
  padding: 6px 12px;
}
`;
