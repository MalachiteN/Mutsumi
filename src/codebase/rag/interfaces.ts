export interface ChunkResult {
  /** 相对于工作区根目录的文件路径 */
  filePath: string;
  /** 符号全限定名（如 MyClass.myMethod），回退到按行时为 null */
  symbolName: string | null;
  startLine: number;
  endLine: number;
  /** chunk 原文 */
  text: string;
  /** 向量距离（cosine），越小越相关 */
  distance: number;
}

export interface ChunkInfo {
  text: string;
  hash: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
}

export interface FileRow {
  id: number;
  relative_path: string;
  file_hash: string;
}
export interface ChunkRow {
  id: number;
  chunk_hash: string;
}
export interface VecMatchRow {
  rowid: number;
  distance: number;
}
export interface ChunkDetailRow {
  chunk_text: string;
  symbol_name: string | null;
  start_line: number;
  end_line: number;
  relative_path: string;
}