/**
 * Minimal typings for the WebMCP imperative API (W3C Web ML CG draft, Chrome 149+ origin trial,
 * ChatGPT desktop browser). Chrome and ChatGPT expose it on `document.modelContext`; older
 * write-ups used `navigator.modelContext`. We feature-detect both.
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  destructiveHint?: boolean;
}

export interface ToolExecuteOptions {
  signal?: AbortSignal;
}

export interface ToolDefinition<A = Record<string, unknown>> {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (args: A, options?: ToolExecuteOptions) => unknown | Promise<unknown>;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ToolDefinition, options?: RegisterToolOptions): Promise<void> | void;
  unregisterTool?(name: string): void;
  getTools?(options?: { fromOrigins?: string[] }): Promise<ToolDefinition[]>;
  executeTool?(tool: ToolDefinition, args: string | Record<string, unknown>, options?: ToolExecuteOptions): Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

/** Returns the WebMCP surface if the browser provides one. */
export function getModelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return document.modelContext ?? navigator.modelContext;
}
