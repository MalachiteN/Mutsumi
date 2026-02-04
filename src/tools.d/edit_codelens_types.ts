export interface DiffCodeLensAction {
  id: string;
  label: string;
  tooltip?: string;
  command?: string;
  // handler 目前主要用于 UI 层的逻辑占位，实际逻辑由 VSCode command 触发
  // 在非 Diff 模式下，可能没有 diffContext
  handler: (filePath: string, diffContext?: DiffContext) => Promise<void>;
}

export interface DiffContext {
  originalPath: string;
  modifiedPath: string;
  tempPath: string;
  content: {
    original: string;
    modified: string;
  };
}

export interface DiffReviewConfig {
  tempDirectory: string;
  actions: DiffCodeLensAction[];
  autoOpen?: boolean;
}