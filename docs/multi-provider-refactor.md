# Multi-Provider Configuration Refactoring Plan

## Overview

Replace the flat `mutsumi.apiKey` and `mutsumi.baseUrl` settings with a new `mutsumi.providers` array. Each model in `mutsumi.models` will reference a provider by name instead of having a descriptive label.

## Configuration Changes

### New: `mutsumi.providers`

```json
{
  "mutsumi.providers": {
    "type": "array",
    "markdownDescription": "Configured LLM API providers",
    "items": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "markdownDescription": "LLM API Provider Name (e.g., OpenAI, Anthropic, llama.cpp)"
        },
        "baseurl": {
          "type": "string",
          "markdownDescription": "LLM API BaseURL (e.g., https://api.openai.com/v1, http://localhost:8080/v1)"
        },
        "api_key": {
          "type": "string",
          "default": "",
          "markdownDescription": "LLM API Key (required, use dummy value for local deployments without authentication)"
        }
      },
      "required": ["name", "baseurl", "api_key"]
    },
    "default": []
  }
}
```

**Note**: `api_key` is required in schema and validated at runtime. For local providers (llama.cpp, etc.) that don't require authentication, any non-empty dummy value can be used.

### Modified: `mutsumi.models`

**Before**: `Record<string, string>` where value was a display label  
**After**: `Record<string, string[]>` where key is the provider name and value is an array of model identifiers

Example:
```json
{
  "mutsumi.models": {
    "ZenMux": [
      "moonshotai/kimi-k2.5",
      "openai/gpt-4.1-nano"
    ],
    "OpenAI-Official": [
      "openai/gpt-4.1-nano"
    ]
  }
}
```

### Modified: Model References in `package.json`

Update descriptions for:
- `mutsumi.defaultModel`: "Default model to use (must be a model listed in mutsumi.models)"
- `mutsumi.titleGeneratorModel`: "Model used for generating agent titles (must be a model listed in mutsumi.models)"
- `mutsumi.compressModel`: "Model used for compressing conversations (must be a model listed in mutsumi.models)"

### Removed

- `mutsumi.apiKey` (string)
- `mutsumi.baseUrl` (string)

## Default Values (Fallback)

When `mutsumi.providers` is empty, provide default providers and models:

```typescript
const DEFAULT_PROVIDERS = [
  { name: "ZenMux", baseurl: "https://zenmux.ai/api/v1", api_key: "" }
];

const DEFAULT_MODELS: Record<string, string[]> = {
  "ZenMux": [
    "openai/gpt-4.1-nano",
    "moonshotai/kimi-k2.5",
    "stepfun/step-3.5-flash",
    "google/gemini-3-pro-preview",
    "minimax/minimax-m2.7-highspeed",
    "openai/gpt-5.4",
    "volcengine/doubao-seed-2.0-pro"
  ]
};
```

## Core API: `utils.ts`

### New Function: `getModelCredentials(modelName: string)`

**Purpose**: Centralized, validated access to provider credentials for a given model.

**Implementation Requirements**:
1. Load `mutsumi.providers` array
2. Load `mutsumi.models` configuration
3. If providers array is empty, use `DEFAULT_PROVIDERS`
4. **Name Normalization**: Trim whitespace from all provider names for both duplicate detection AND lookup. Case-sensitive comparison after trimming.
5. Validate provider names are unique after normalization (throw Error if duplicates found)
6. Find the provider that lists the given model (iterate provider→models mapping; first match wins if a model appears under multiple providers). Provider name is trimmed during lookup.
7. If provider not found, throw Error
8. Validate `baseurl` is non-empty after trimming
9. Validate `api_key` is non-empty (required)
10. Return the credentials with property name mapping (`api_key` → `apiKey`, `baseurl` → `baseUrl`)

**Signature**:
```typescript
export function getModelCredentials(modelName: string): { 
  apiKey: string; 
  baseUrl: string;
}
```

**Error Cases** (throw Error with descriptive message):
- `Duplicate provider name after normalization: "${trimmedName}"`
- `Model "${modelName}" not found in configuration`
- `Provider "${providerName}" for model "${modelName}" not found`
- `Provider "${providerName}" has empty baseurl`
- `Provider "${providerName}" has empty api_key`

### Modified Function: `getModelsConfig()`

Returns `Record<string, string[]>` (provider name → model identifiers array):
- If user-configured models is empty, return `DEFAULT_MODELS`
- Keys are provider names, values are arrays of model identifiers

### New Function: `getAvailableModelNames()`

Returns `string[]` — a flattened, deduplicated list of all model names across all providers. Used by validation code that needs to check if a model name is valid.

## Property Name Convention

**Schema and Interface** (snake_case):
- `package.json`: `baseurl`, `api_key`
- TypeScript `Provider` interface: `baseurl`, `api_key`

**Runtime Credentials** (camelCase):
- `getModelCredentials()` returns: `baseUrl`, `apiKey`
- All existing code uses camelCase

The mapping happens only in `getModelCredentials()`:
```typescript
return {
  apiKey: provider.api_key,
  baseUrl: provider.baseurl
};
```

## Files to Modify

### 1. `package.json`

- Add new `mutsumi.providers` configuration
- Remove `mutsumi.apiKey` and `mutsumi.baseUrl`
- Update `mutsumi.models` description: "Provider to models mapping. Key is the provider name from mutsumi.providers, value is an array of model identifiers supported by that provider"
- Update `defaultModel`, `titleGeneratorModel`, `compressModel` descriptions to reference models listed in mutsumi.models

### 2. `src/utils.ts`

- Add `Provider` interface (snake_case properties):
  ```typescript
  interface Provider {
    name: string;
    baseurl: string;
    api_key: string;
  }
  ```
- Add `DEFAULT_PROVIDERS` constant
- Update `DEFAULT_MODELS` to `Record<string, string[]>` (provider name → model identifiers array)
- Implement `getModelCredentials(modelName: string)` function with normalization and validation
- Update `getModelsConfig()` to return `Record<string, string[]>` and use default models when empty
- Add `getAvailableModelNames()` helper to flatten provider→models mapping into unique model names

### 3. `src/controller.ts`

**Before**:
```typescript
const apiKey = config.get<string>('apiKey');
const baseUrl = config.get<string>('baseUrl');
// ...
if (!apiKey) {
  await session.replaceOutput('Error: Please set mutsumi.apiKey in VSCode Settings.');
```

**After**:
```typescript
let credentials: { apiKey: string; baseUrl: string };
try {
  credentials = getModelCredentials(model);
} catch (err: any) {
  await session.replaceOutput(`Error: ${err.message}`);
  (session as any).end(false);
  return;
}
const { apiKey, baseUrl } = credentials;
// getModelCredentials guarantees apiKey and baseUrl are non-empty
```

### 4. `src/agent/agentRunner.ts`

In `generateTitle()` method, replace:
```typescript
const apiKey = config.get<string>('apiKey');
const baseUrl = config.get<string>('baseUrl') || sessionConfig.baseUrl;
// ...
if (!titleGeneratorModel || !apiKey) {
  debugLogger.log(`[AgentRunner] Title generation skipped: missing ${!titleGeneratorModel ? 'titleGeneratorModel' : 'apiKey'}`);
  return;
}
```

With:
```typescript
if (!titleGeneratorModel) {
  debugLogger.log('[AgentRunner] Title generation skipped: missing titleGeneratorModel');
  return;
}

let credentials: { apiKey: string; baseUrl: string };
try {
  credentials = getModelCredentials(titleGeneratorModel);
} catch (err: any) {
  debugLogger.log(`[AgentRunner] Title generation skipped: ${err.message}`);
  return;
}
const { apiKey, baseUrl } = credentials;
```

### 5. `src/agent/titleGenerator.ts`

**TitleGeneratorConfig interface**: Remove `apiKey` and `baseUrl` fields.

**Function: `getTitleGeneratorConfig()`**: Remove apiKey/baseUrl from returned config.

**Function: `shouldGenerateTitle()`**: Update to check only `titleGeneratorModel` availability, not apiKey.

**Function: `generateTitleForSession()`**: Add try/catch around credential lookup:
```typescript
let credentials: { apiKey: string; baseUrl: string };
try {
  credentials = getModelCredentials(model);
} catch (err: any) {
  throw new Error(`Title generation failed: ${err.message}`);
}
```

**Function: `regenerateTitleForSession()`**: Same credential lookup with try/catch.

**Update error message at line ~290**: From `'Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel...'` to new configuration guidance if needed.

### 6. `src/httpServer/chat.ts`

**Before**:
```typescript
const apiKey = config.get<string>('apiKey');
const baseUrl = config.get<string>('baseUrl') || undefined;
// ...
if (!apiKey) {
  res.status(500).json({ status: 'error', content: 'No API key configured. Set mutsumi.apiKey in VS Code settings.' });
  return;
}
```

**After**:
```typescript
let credentials: { apiKey: string; baseUrl: string };
try {
  credentials = getModelCredentials(effectiveModel);
} catch (err: any) {
  res.status(400).json({ status: 'error', content: err.message });
  return;
}
const { apiKey, baseUrl } = credentials;
```

### 7. `src/notebook/commands/compressConversation.ts`

**Before**:
```typescript
const apiKey = config.get<string>('apiKey');
const baseUrl = config.get<string>('baseUrl');
// ...
if (!compressModel || !apiKey) {
  vscode.window.showErrorMessage('Please configure mutsumi.apiKey and mutsumi.compressModel (or defaultModel) in settings.');
  return;
}
```

**After**:
```typescript
if (!compressModel) {
  vscode.window.showErrorMessage('Please configure mutsumi.compressModel or mutsumi.defaultModel in settings.');
  return;
}

let credentials: { apiKey: string; baseUrl: string };
try {
  credentials = getModelCredentials(compressModel);
} catch (err: any) {
  vscode.window.showErrorMessage(`Compression failed: ${err.message}`);
  return;
}
const { apiKey, baseUrl } = credentials;
```

### 8. `src/notebook/commands/regenerateTitle.ts`

**Analysis**: This file calls `getTitleGeneratorConfig()` and `regenerateTitleForSession()`. No direct credential access.

**Action**: No changes needed IF `getTitleGeneratorConfig()` returns valid config and `regenerateTitleForSession()` handles credential errors internally (which it will after titleGenerator.ts changes).

**Verification**: Ensure imports and function calls still work after titleGenerator.ts refactor.

### 9. `src/notebook/commands/selectModel.ts`

**Updated**: Model selection now groups models by provider using QuickPick separators. Each provider name appears as a separator, with its models listed beneath.

```typescript
const modelItems: SelectModelQuickPickItem[] = [];
for (const [providerName, modelNames] of providerEntries) {
    modelItems.push({
        itemType: 'separator',
        label: providerName,
        kind: vscode.QuickPickItemKind.Separator
    });
    for (const modelName of modelNames) {
        modelItems.push({
            itemType: 'model',
            value: modelName,
            label: modelName,
            // ...
        });
    }
}
```

### 10. `src/agent/fileOps.ts`

**Updated**: Model validation now uses `getAvailableModelNames()` instead of `Object.keys(getModelsConfig())` to flatten the provider→models mapping into a list of valid model names.

```typescript
const availableModelNames = getAvailableModelNames();
const selectedModel = (defaults.model && availableModelNames.includes(defaults.model)) 
    ? defaults.model 
    : vscodeDefaultModel;
```

## Files NOT Requiring Changes

- `src/agent/llmClient.ts` - Interface remains unchanged; callers provide credentials
- `src/agent/types.ts` - Type definitions remain valid
- `src/adapters/interfaces.ts` - Interface remains unchanged
- `src/httpServer/model.ts` - Uses `getAvailableModelNames()` for model validation

## HTTP Server API Behavior

REST API endpoints accepting `model` parameter will:
1. Receive model name in request
2. Use `getModelCredentials(model)` to resolve provider
3. Return 400 error if model or provider not found

No API changes required - existing `model` parameter handling remains.

## Error Handling

All errors from `getModelCredentials()` should be caught and displayed to user via:
- `vscode.window.showErrorMessage()` for UI commands
- HTTP error response (400 status) for REST API
- Debug logger for background tasks (title generation)

Validation errors include:
- `Duplicate provider name after normalization: "${trimmedName}"`
- `Model "${modelName}" not found in configuration`
- `Provider "${providerName}" for model "${modelName}" not found`
- `Provider "${providerName}" has empty baseurl`
- `Provider "${providerName}" has empty api_key`

## Migration Notes (Breaking Change)

This is a breaking change with no backward compatibility:
- Users must reconfigure with new `providers` array
- Old `apiKey` and `baseUrl` settings are ignored
- `models` is now a provider→models array mapping (key is provider name, value is array of model identifiers)
- Error messages from getModelCredentials replace old "Please set mutsumi.apiKey" messages
