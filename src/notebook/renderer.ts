/**
 * @fileoverview Custom notebook renderer for Mutsumi agent chat output.
 * Uses micromark for Markdown parsing, lowlight (highlight.js) for syntax
 * highlighting, and implements incremental DOM rendering.
 * @module notebook/renderer
 */

import { RENDERER_CSS } from './css';

import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { createLowlight, all } from 'lowlight';
import { toHtml } from 'hast-util-to-html';

// Types matching src/notebook/renderTypes.ts (duplicated here to avoid
// importing from extension code in the renderer process)
type RenderBlock =
  | { type: 'content'; markdown: string }
  | { type: 'reasoning'; markdown: string; collapsed: boolean }
  | {
      type: 'toolCall';
      name: string;
      args: Record<string, any>;
      summary: string;
      result?: string;
      isStreaming: boolean;
      renderingConfig?: {
        argsToCodeBlock?: string[];
        codeBlockFilePaths?: (string | undefined)[];
      };
    };

interface RenderData {
  committed: RenderBlock[];
  active: {
    reasoning: string;
    content: string;
    pendingTools: RenderBlock[];
  } | null;
}

// --- DOM Cache for incremental rendering ---
interface OutputCache {
  committedContainer: HTMLElement;
  activeContainer: HTMLElement;
  lastCommittedLength: number;
  blockElements: Map<number, HTMLElement>;  // index → DOM element
}

const outputCaches = new Map<string, OutputCache>();

/**
 * Parse markdown to HTML using micromark with GFM support.
 */
function renderMarkdown(md: string): string {
  if (!md) return '';
  return micromark(md, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
    allowDangerousProtocol: true,
  } as any);
}

// --- Syntax highlighting via lowlight (highlight.js) ---
// Uses all highlight.js grammars for comprehensive language coverage.
const lowlight = createLowlight(all);

// Register aliases for file extensions not covered by highlight.js defaults.
lowlight.registerAlias({ xml: ['htm', 'vue', 'svelte', 'astro'] });
lowlight.registerAlias('scss', 'sass');
lowlight.registerAlias('bash', 'fish');

/**
 * Resolve a file extension to a registered lowlight language identifier.
 * Checks the extension directly (covers highlight.js built-in aliases like
 * `ts`→typescript, `py`→python, `h`→c, `hpp`→cpp, etc.) and the custom
 * aliases registered above.
 */
function getLanguageIdentifier(ext: string): string {
  const id = ext.toLowerCase();
  return lowlight.registered(id) ? id : '';
}

/**
 * Highlight a `<code>` element's text content using lowlight.
 * Replaces innerHTML with tokenized HTML if the language is registered.
 */
function highlightElement(codeEl: HTMLElement, lang: string): void {
  if (!lang || !lowlight.registered(lang)) return;
  const text = codeEl.textContent || '';
  if (!text) return;
  try {
    const tree = lowlight.highlight(lang, text);
    codeEl.innerHTML = toHtml(tree);
    codeEl.classList.add('hljs');
  } catch {
    // Unknown language or parse failure: leave code as-is
  }
}

/**
 * Find all `<pre><code>` elements in a container and syntax-highlight them.
 * Used after inserting micromark-generated HTML to apply token highlighting.
 */
function highlightCodeBlocks(container: HTMLElement): void {
  container.querySelectorAll('pre > code').forEach((code) => {
    const el = code as HTMLElement;
    const match = el.className.match(/language-([^\s]+)/);
    highlightElement(el, match ? match[1].toLowerCase() : '');
  });
}

/**
 * Shape of the OutputItem passed by VS Code to renderOutputItem.
 * Current API (see vscode-notebook-renderer types): data/text/json/blob are
 * synchronous METHODS. Older builds exposed `data` as a Uint8Array property,
 * so both forms are handled.
 */
interface RendererOutputItem {
  id: string;
  mime: string;
  data: Uint8Array | (() => Uint8Array);
  text?: () => string;
  json?: () => unknown;
}

/**
 * Extract the output item's payload as text, tolerating both the current
 * method-based API and the legacy `data` property form.
 */
function readOutputText(outputItem: RendererOutputItem): string {
  if (typeof outputItem.text === 'function') {
    return outputItem.text();
  }
  const data = outputItem.data;
  if (typeof data === 'function') {
    return new TextDecoder().decode(data());
  }
  return new TextDecoder().decode(data);
}

/**
 * Render a single RenderBlock to a DOM element.
 */
function renderBlock(block: RenderBlock): HTMLElement {
  const div = document.createElement('div');
  div.className = 'mutsumi-block';

  switch (block.type) {
    case 'content': {
      div.innerHTML = renderMarkdown(block.markdown);
      highlightCodeBlocks(div);
      break;
    }
    case 'reasoning': {
      const details = document.createElement('details');
      if (!block.collapsed) details.setAttribute('open', '');
      const summary = document.createElement('summary');
      summary.textContent = '💭 Thinking Process';
      details.appendChild(summary);
      const content = document.createElement('div');
      content.className = 'mutsumi-reasoning-content';
      content.innerHTML = renderMarkdown(block.markdown);
      highlightCodeBlocks(content);
      details.appendChild(content);
      div.appendChild(details);
      break;
    }
    case 'toolCall': {
      const details = document.createElement('details');
      if (block.isStreaming) details.setAttribute('open', '');
      const summary = document.createElement('summary');
      const prefix = block.isStreaming ? '⏳ ' : '';
      const suffix = block.isStreaming ? ' ...' : '';
      summary.textContent = `${prefix}${block.summary}${suffix}`;
      details.appendChild(summary);

      // Arguments section
      const argsDiv = document.createElement('div');
      argsDiv.className = 'mutsumi-tool-args';
      const argsTitle = document.createElement('strong');
      argsTitle.textContent = `Arguments${block.isStreaming ? ' (Streaming)' : ''}:`;
      argsDiv.appendChild(argsTitle);

      // Separate code block args from regular args
      const codeBlockArgs = new Set(block.renderingConfig?.argsToCodeBlock ?? []);
      const regularArgs: Record<string, any> = {};
      const codeArgs: Record<string, any> = {};
      for (const [key, value] of Object.entries(block.args)) {
        if (codeBlockArgs.has(key)) {
          codeArgs[key] = value;
        } else {
          regularArgs[key] = value;
        }
      }

      // Render regular args as a list
      if (Object.keys(regularArgs).length > 0) {
        const ul = document.createElement('ul');
        for (const [key, value] of Object.entries(regularArgs)) {
          const li = document.createElement('li');
          const code1 = document.createElement('code');
          code1.textContent = key;
          const code2 = document.createElement('code');
          code2.textContent = JSON.stringify(value);
          li.appendChild(code1);
          li.appendChild(document.createTextNode(': '));
          li.appendChild(code2);
          ul.appendChild(li);
        }
        argsDiv.appendChild(ul);
      }

      // Render code block args
      if (block.renderingConfig?.argsToCodeBlock) {
        for (let i = 0; i < block.renderingConfig.argsToCodeBlock.length; i++) {
          const argName = block.renderingConfig.argsToCodeBlock[i];
          const val = codeArgs[argName];
          if (val !== undefined && val !== null) {
            // Detect language from file path if available
            let lang = '';
            if (!block.isStreaming && block.renderingConfig.codeBlockFilePaths) {
              const pathArgName = block.renderingConfig.codeBlockFilePaths[i];
              if (pathArgName) {
                const pathVal = block.args[pathArgName];
                if (typeof pathVal === 'string') {
                  const ext = pathVal.split('.').pop() || '';
                  lang = getLanguageIdentifier(ext);
                }
              }
            }
            const label = document.createElement('div');
            label.innerHTML = `<strong>${argName}:</strong>`;
            argsDiv.appendChild(label);
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = lang ? `language-${lang}` : '';
            code.textContent = String(val);
            pre.appendChild(code);
            argsDiv.appendChild(pre);
            highlightElement(code, lang);
          }
        }
      }

      details.appendChild(argsDiv);

      // Result section
      if (block.result !== undefined) {
        const resultTitle = document.createElement('div');
        resultTitle.innerHTML = '<strong>Result:</strong>';
        details.appendChild(resultTitle);
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = block.result;
        pre.appendChild(code);
        details.appendChild(pre);
      }

      div.appendChild(details);
      break;
    }
  }
  return div;
}

/**
 * Main renderer activation function.
 * Called by VSCode when the renderer module is loaded.
 */
export function activate() {
  // Inject styles once per renderer activation; VSCode only loads the
  // entrypoint JS, so the CSS file produced by esbuild would otherwise be ignored.
  const styleId = 'mutsumi-renderer-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = RENDERER_CSS;
    document.head.appendChild(style);
  }

  return {
    /**
     * Render a notebook cell output item.
     * Implements incremental rendering: committed blocks are DOM-cached,
     * only new blocks and the active area are re-rendered.
     */
    renderOutputItem(
      outputItem: RendererOutputItem,
      element: HTMLElement,
      _signal: { readonly aborted: boolean }
    ): void {
      let data: RenderData;
      try {
        data = JSON.parse(readOutputText(outputItem));
      } catch (err) {
        // Surface full diagnostics instead of swallowing the error,
        // so parse failures can be debugged from the rendered output itself.
        let rawPreview = '(unable to decode raw data)';
        try { rawPreview = readOutputText(outputItem).slice(0, 500); } catch { /* keep fallback */ }

        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        console.error('[mutsumi-renderer] Failed to parse render data', {
          reason,
          mime: outputItem.mime,
          outputItemKeys: Object.keys(outputItem),
          rawPreview,
        });

        element.textContent = '';
        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.color = 'var(--vscode-errorForeground, red)';
        pre.textContent =
          'Error: Failed to parse render data\n' +
          `  reason: ${reason}\n` +
          `  mime: ${outputItem.mime}\n` +
          `  outputItem keys: ${Object.keys(outputItem).join(', ')}\n` +
          `  raw preview (first 500 chars):\n${rawPreview}`;
        element.appendChild(pre);
        return;
      }

      // Get or create cache for this output
      let cache = outputCaches.get(outputItem.id);
      if (!cache) {
        // First render: create container structure
        const committedContainer = document.createElement('div');
        committedContainer.className = 'mutsumi-committed';
        const activeContainer = document.createElement('div');
        activeContainer.className = 'mutsumi-active';
        element.appendChild(committedContainer);
        element.appendChild(activeContainer);

        cache = {
          committedContainer,
          activeContainer,
          lastCommittedLength: 0,
          blockElements: new Map(),
        };
        outputCaches.set(outputItem.id, cache);
      }

      // Incremental committed rendering: only append new blocks
      const committed = data.committed || [];
      if (committed.length < cache.lastCommittedLength) {
        // Committed shrank (new conversation round, output replaced)
        // Clear all committed DOM and re-render
        cache.committedContainer.innerHTML = '';
        cache.blockElements.clear();
        cache.lastCommittedLength = 0;
      }

      for (let i = cache.lastCommittedLength; i < committed.length; i++) {
        const blockEl = renderBlock(committed[i]);
        cache.blockElements.set(i, blockEl);
        cache.committedContainer.appendChild(blockEl);
      }
      cache.lastCommittedLength = committed.length;

      // Active area: full replace (small, low cost)
      cache.activeContainer.innerHTML = '';
      if (data.active) {
        // Reasoning (currently streaming)
        if (data.active.reasoning) {
          const block = renderBlock({
            type: 'reasoning',
            markdown: data.active.reasoning,
            collapsed: false  // Open during streaming
          });
          cache.activeContainer.appendChild(block);
        }
        // Content (currently streaming)
        if (data.active.content) {
          const block = renderBlock({
            type: 'content',
            markdown: data.active.content
          });
          cache.activeContainer.appendChild(block);
        }
        // Pending tools (streaming)
        for (const pt of data.active.pendingTools) {
          cache.activeContainer.appendChild(renderBlock(pt));
        }
      }
    },

    /**
     * Dispose a rendered output item and clean up cache.
     */
    disposeOutputItem(outputId: string): void {
      outputCaches.delete(outputId);
    }
  };
}
