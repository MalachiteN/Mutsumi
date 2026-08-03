# Multi-Provider Configuration

This document describes the implemented multi-provider configuration design in Mutsumi. It is not a future plan; it reflects the current behavior after the strict breaking refactor.

## Overview

A model selection is always an explicit `{ model, provider }` pair. The system never infers a provider from ordering when more than one provider declares the same model. There is no compatibility layer for legacy string-valued settings or persisted agents missing an explicit provider.

## Configuration

### `mutsumi.providers`

Array of provider objects using snake_case for settings schema alignment:

```json
{
  "mutsumi.providers": [
    {
      "name": "kimi-for-coding",
      "baseurl": "https://api.kimi.com/coding/v1",
      "api_key": ""
    }
  ]
}
```

- `name`: provider identifier
- `baseurl`: API base URL
- `api_key`: API key; may be empty in settings, but runtime credential use will report a configuration error until filled

### `mutsumi.models`

Provider-to-models mapping. Key is the provider name, value is the array of model identifiers supported by that provider:

```json
{
  "mutsumi.models": {
    "kimi-for-coding": ["kimi-for-coding"]
  }
}
```

### `mutsumi.defaultModel`, `mutsumi.titleGeneratorModel`, `mutsumi.compressModel`

All three are objects with required `model` and `provider`:

```json
{
  "mutsumi.defaultModel": {
    "model": "kimi-for-coding",
    "provider": "kimi-for-coding"
  }
}
```

Legacy string values are rejected by the schema and by runtime type guards.

## Built-in Defaults

When no providers are configured, Mutsumi falls back to:

```typescript
const DEFAULT_PROVIDERS: Provider[] = [
  { name: "kimi-for-coding", baseurl: "https://api.kimi.com/coding/v1", api_key: "" }
];

const DEFAULT_MODELS: Record<string, string[]> = {
  "kimi-for-coding": ["kimi-for-coding"]
};

const DEFAULT_MODEL_SELECTION: ModelSelection = {
  model: "kimi-for-coding",
  provider: "kimi-for-coding"
};
```

The built-in default `api_key` is intentionally empty so users can fill it via settings; a missing key produces a runtime configuration error only when credentials are actually requested.

## Resolution Gate

`resolveModelSelection(selection)` in `src/utils.ts` is the single validation gate:

1. Verify `selection` is an object with non-empty string `model` and `provider`
2. Trim both names
3. Verify the provider exists
4. Verify the provider declares the model
5. Return the canonical `{ model, provider }` pair

Any failure throws a descriptive error. There is no first-match fallback, no provider inference, and no legacy string handling.

## Credential Lookup

`getModelCredentials(model, provider)` requires both values, validates them through `resolveModelSelection`, then returns `{ apiKey, baseUrl }`. Empty `baseurl` or `api_key` throws a descriptive error.

## Agent Default Resolution

`resolveAgentDefaults(agentType, options?)` in `src/config/resolver.ts` applies the following chain:

```text
options.modelSelection > AgentTypeConfig.defaultModel > mutsumi.defaultModel > error
```

All hardcoded model fallbacks have been removed.

## Persistence

Agent notebook metadata stores the pair flatly:

```typescript
interface AgentMetadata {
  model?: string;
  provider?: string;
}
```

New agents always persist both. Legacy files missing `provider` produce a migration/configuration error at execution time.

The single write point for mutating the persisted pair is `AgentFileOperations.updateAgentModelSelection(fileUri, selection)`, which uses `NotebookEdit.updateNotebookMetadata` when the notebook is open and raw file I/O otherwise.

## Creation Paths

1. **Root/entry agents** — `MutsumiSerializer.createDefaultContent()` resolves the complete pair through `resolveAgentDefaults()` and persists both fields.
2. **Dispatched children** — `AgentFileOperations.createAgentFile()` accepts an optional `ModelSelection`, resolves through the resolver chain, validates through the gate, and persists both fields.
3. **Compression output** — `compressConversation.ts` validates the source metadata pair through `resolveModelSelection()` before producing a new `.mtm`. Invalid source → error, no file created. The new file inherits the validated pair.

## HTTP Contract

### `PUT /agent/:uuid/model`

Body must contain complete `{ model, provider }`. Missing either → `400`. Invalid pair → `400`. Persisted atomically via `AgentFileOperations.updateAgentModelSelection`, then the cached `HeadlessAdapter` session metadata is synchronized.

### `POST /agent/:uuid/chat`

Body `model`/`provider` are all-or-nothing:

- Both present → validate, use for this request, and persist as the agent's new selection
- Neither present → use persisted pair; missing `model` → fall back to global default selection; `model` without `provider` → `400` migration error
- Exactly one present → `400`

## Execution Paths

- `src/controller.ts` removes the old `gpt-3.5-turbo` fallback. Notebook metadata rules match the HTTP chat contract.
- `src/agent/agentRunner.ts` title generation reads `mutsumi.titleGeneratorModel`, then falls back to the session metadata pair, then skips.
- `src/agent/titleGenerator.ts` uses `TitleGeneratorConfig { modelSelection?: ModelSelection }` and resolves credentials with `getModelCredentials(model, provider)`.
- `src/notebook/commands/compressConversation.ts` uses `getCompressModelSelection()` and validates the source pair before producing output.

## Display

QuickPick and tool output format the selection as `model (provider)`, for example `kimi-for-coding (kimi-for-coding)`.

## Error Handling

All core validation errors are descriptive English strings. UI layers wrap them with `t()` where appropriate. HTTP endpoints return `400` for invalid pairs and `500` for unexpected failures.

## Same Model Names Across Providers

When the same model identifier appears under multiple providers, the explicit provider in the selection disambiguates it. There is no first-match substitution.

## Out of Scope

- No migration layer for legacy string settings or pre-provider metadata
- No provider field in `AgentRunOptions` or `AgentSessionConfig`
- No changes to adapter interfaces
