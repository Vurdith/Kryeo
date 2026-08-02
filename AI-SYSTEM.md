# Kryeo Visual Intelligence

Kryeo uses a hybrid visual-family pipeline.

1. Affinity exports isolated previews and hierarchy metadata to temporary staging.
2. Kryeo hashes exact duplicates locally.
3. MobileCLIP creates embeddings only for visual grouping and approved-memory retrieval.
4. Approved visual families are reused without a network request.
5. Novel families are sent together to the authenticated Kryeo AI server.
6. Qwen analyses each family using its visuals, hierarchy, sibling context, project rules, and meaningful layer names.
7. A text-only reconciliation pass checks the complete document for inconsistent names, types, and roles.
8. The user approves or corrects the review. That family decision is stored for the project and reused later.

Local embeddings never decide semantic asset types. There are no confidence percentages in the review UI. If hosted analysis is unavailable, unresolved values remain visibly provisional.

## Privacy

- The gateway receives in-memory PNG previews, not Affinity documents.
- Source images are not written to server storage.
- The persistent gateway cache contains structured model results only.
- Desktop access tokens are stored with Electron safe storage when the operating system supports it.
- Model proposals cannot directly execute Affinity actions.

## Run The Home Server

The first deployment targets one RTX 4070 SUPER with a Qwen3.5-9B multimodal GGUF and matching `mmproj` file.

1. Start a current `llama-server`:

```powershell
.\services\ai-server\scripts\start-qwen.ps1 `
  -LlamaServer C:\AI\llama-server.exe `
  -Model C:\AI\qwen3.5-9b-q5_k_m.gguf `
  -Mmproj C:\AI\mmproj-qwen3.5-9b-f16.gguf
```

2. Copy `services\ai-server\.env.example` to `services\ai-server\.env`.
3. Generate a token with `npm run token --prefix services\ai-server`.
4. Put the token in `KRYEO_AI_TOKENS`.
5. Run `npm start --prefix services\ai-server`.
6. In Kryeo Settings, enter the gateway address and token.

The development gateway binds to loopback. For public access, put it behind HTTPS, keep the raw model server private, and issue independently revocable per-user tokens. The in-process queue is appropriate for the first home-hosted beta; a paid multi-replica service must move tokens, rate limits, and queues to shared infrastructure.

## Validation

```powershell
npm run test:family-ai
npm run test:family-ai-service
npm run typecheck
npm run build
```

The gateway test starts a mock OpenAI-compatible multimodal server and verifies authentication, family analysis, cache reuse, reconciliation, and Assistant chat.
