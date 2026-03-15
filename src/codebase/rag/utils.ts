// src/codebase/rag/utils.ts

import * as vscode from "vscode";
import * as crypto from "crypto";
import { ChunkInfo } from "./interfaces";

// ════════════════════════════════════════════════════════════════════════════
//  Pure helpers（无副作用工具函数）
// ════════════════════════════════════════════════════════════════════════════

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** 短 hash（前16位），用于目录名等场景 */
export function sha256Short(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** number[] → Buffer（sqlite‑vec 接受 Float32Array 的裸字节） */
export function f32buf(vec: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

export function mkChunk(
  text: string,
  symbolName: string | null,
  startLine: number,
  endLine: number
): ChunkInfo {
  return { text, hash: sha256(text), symbolName, startLine, endLine };
}

export function isDocumentSymbolArray(
  arr: vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined
): arr is vscode.DocumentSymbol[] {
  if (!arr || arr.length === 0) {
    return false;
  }
  return "children" in arr[0];
}

// ════════════════════════════════════════════════════════════════════════════
//  Chunking strategies
// ════════════════════════════════════════════════════════════════════════════

/**
 * 按符号边界切块。
 *
 * 策略：递归展开到叶子符号（函数、方法、变量等），
 * 符号之间的空隙（import、注释…）单独成块。
 */
export function symbolChunks(
  lines: string[],
  symbols: vscode.DocumentSymbol[],
  parentName?: string
): ChunkInfo[] {
  // 收集所有叶子符号
  const leaves: { name: string; start: number; end: number }[] = [];

  (function walk(syms: vscode.DocumentSymbol[], prefix?: string) {
    for (const s of syms) {
      const fqn = prefix ? `${prefix}.${s.name}` : s.name;
      if (s.children && s.children.length > 0) {
        // 容器符号（class / namespace）→ 递归
        walk(s.children, fqn);
      } else {
        leaves.push({
          name: fqn,
          start: s.range.start.line,
          end: s.range.end.line,
        });
      }
    }
  })(symbols, parentName);

  // 按起始行排序
  leaves.sort((a, b) => a.start - b.start);

  const chunks: ChunkInfo[] = [];
  let cursor = 0;

  for (const lf of leaves) {
    // 符号前的间隙文本
    if (lf.start > cursor) {
      const gap = lines.slice(cursor, lf.start).join("\n").trim();
      if (gap) {
        chunks.push(mkChunk(gap, null, cursor, lf.start - 1));
      }
    }
    // 符号本身
    const body = lines.slice(lf.start, lf.end + 1).join("\n");
    if (body.trim()) {
      chunks.push(mkChunk(body, lf.name, lf.start, lf.end));
    }
    cursor = Math.max(cursor, lf.end + 1);
  }

  // 尾部剩余文本
  if (cursor < lines.length) {
    const tail = lines.slice(cursor).join("\n").trim();
    if (tail) {
      chunks.push(mkChunk(tail, null, cursor, lines.length - 1));
    }
  }

  return chunks;
}

/**
 * 按行切块（回退方案）。
 * 每 50 行为一个 chunk，适用于配置文件、纯文本等无 LSP 的场景。
 */
export function lineChunks(lines: string[], size = 50): ChunkInfo[] {
  const out: ChunkInfo[] = [];
  for (let i = 0; i < lines.length; i += size) {
    const end = Math.min(i + size, lines.length);
    const text = lines.slice(i, end).join("\n").trim();
    if (text) {
      out.push(mkChunk(text, null, i, end - 1));
    }
  }
  return out;
}
