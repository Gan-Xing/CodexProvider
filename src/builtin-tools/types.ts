export type JsonRecord = Record<string, any>;

export type CodexProviderBuiltinToolName =
  | 'web_search'
  | 'file_search'
  | 'tool_search'
  | 'mcp'
  | 'skill'
  | 'shell'
  | 'local_shell'
  | 'computer'
  | 'code_interpreter'
  | 'image_generation'
  | 'apply_patch';

export type CodexProviderBuiltinToolMode =
  | 'provider-native'
  | 'adapter-emulated'
  | 'codex-local-first'
  | 'declaration-only';

export interface CodexProviderBuiltinToolDefinition {
  name: CodexProviderBuiltinToolName;
  openaiToolTypes: string[];
  toolModes: CodexProviderBuiltinToolMode[];
  adapterEmulatedSupported: boolean;
  providerNativeSupported: boolean;
  requiresExecutor: boolean;
  unsafeByDefault: boolean;
  defaultEmulatedToolName: string;
  description: string;
  parameters: JsonRecord;
  status: 'supported' | 'partial' | 'planned' | 'local-first';
}
