# Kryeo Build & Release

> Runtime contract documentation for the checked-out `family-v83` source. The installer record below does not prove that a separately running local gateway has been updated or restarted.

## Recorded package state

- Source checkout version: `0.15.139`
- Installer: `C:\Users\reece\Desktop\Kryeo\release\Kryeo-Setup-0.15.139.exe`
- Installer bytes: `272234463`
- Installer SHA-256: `FA5BA50963448F5FD7B7735733571981399800B5EB95B632AFAFFDA71B5207B0`
- Packaged app.asar bytes: `202635407`
- Packaged app.asar SHA-256: `116ED3BF2AE9915EC7F0959819209794746A75AA06295F6471D537B567FAF1E9`
- Installed executable: `C:\Users\reece\AppData\Local\Programs\Kryeo\Kryeo.exe`
- Installed product version before installing this release: `0.15.78.0`
- Installed package: `C:\Users\reece\AppData\Local\Programs\Kryeo\resources\app.asar`
- Installed package timestamp: `2026-08-13 21:46:54 +01:00`

Historical release snapshots are intentionally excluded from active documentation. Use Git history when older implementation context is genuinely required.

## Validation

```powershell
npm install
npm run typecheck
npm run test:library
npm run test:ipc-contract
npm run test:ui-contract
npm run test:affinity-connection
npm run test:evaluation
npm run test:affinity-export
npm run test:component-context
npm run test:component-learning
npm run test:component-scan
npm run test:scan-intent
npm run test:local-ai
npm run test:family-ai
npm test --prefix services\ai-server
node --check services\ai-server\src\server.mjs
git diff --check
npm run dist
```

`npm run dist` creates `release\Kryeo-Setup-<version>.exe` and verifies packaged resources. A successful package does not prove that the installed app was replaced: close only installed Kryeo processes, run the installer, relaunch, then verify the Windows product version and installed `app.asar` timestamp. It also does not package, deploy, stop, or restart `services\ai-server`; gateway deployment and restart are a separate release step.

## Hosted classification runtime

| Part | Current value |
| --- | --- |
| Primary model | `qwen/qwen3.7-flash` through OpenRouter |
| Independent reviewer | `qwen/qwen3.7-flash` through OpenRouter |
| Local gateway | `http://127.0.0.1:8787` |
| Analysis contract | `family-v83` |
| Client dispatch | Two concurrent requests; up to 8 families per request |
| Gateway model slots | `2` |
| Model deadline | `KRYEO_AI_MODEL_TIMEOUT_MS=35000` by default |
| Model retries | `KRYEO_AI_MAX_MODEL_RETRIES=0` by default; maximum one when explicitly enabled |
| Decision packets | Atomic complete primary packets; one bounded complete reviewer replacement only |
| Normal scan target | `$0.01` |
| Enforced scan ceiling | `$0.03` |
| Family count cap | Unlimited; dollar ceiling remains authoritative |
| Generated cache | `services\ai-server\.data\family-cache.json` |

The desktop sends unresolved export scopes through the authenticated Kryeo gateway. Embedded MobileCLIP supplies optional preprocessing/context and is not the final classifier for an unresolved scope. Hierarchy selects decision scopes before render hashes identify exact duplicate representations, so visually similar nodes in different scopes are not merged. Construction children, organizational parents, and flattened duplicate representations are non-exported; an `Unknown` result stays unresolved and cannot export automatically. Provider credentials remain server-side in `services\ai-server\.env` or the deployment secret store.

## Restart the local gateway separately

The Electron installer does not manage the local Node gateway. After changing `services\ai-server` source or `.env`, stop the existing gateway, start the updated one, and verify it before scanning. Do this independently of building or installing the desktop app.

Start and inspect the local gateway after the previous instance has stopped:

```powershell
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'src/server.mjs' `
  -WorkingDirectory 'C:\Users\reece\Desktop\Kryeo\services\ai-server' `
  -WindowStyle Hidden

$headers = @{ Authorization = 'Bearer <Kryeo AI token>' }
Invoke-RestMethod http://127.0.0.1:8787/health -Headers $headers
```

The health response must report Qwen3.7 Flash as both the primary model and independent reviewer, `family-v83`, two model slots, 10-family batching, `maxModelRetries: 1` when unset, a `$0.01` target, and an enforced `$0.03` ceiling. A mismatched `analysisVersion` means the desktop must not scan against that process.

## Clear generated family results

1. Wait for active visual analysis to finish.
2. Send the authenticated cache-clear request:

   ```powershell
   $headers = @{ Authorization = 'Bearer <Kryeo AI token>' }
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/v1/cache/clear -Headers $headers
   ```

3. Confirm the response contains `cleared: true`, `analysisVersion: family-v83`, and `cacheEntries: 0`.

`POST /v1/cache/clear` waits for a pending cache write and refuses with `409` while work is active; it clears both memory and the derived cache file safely. This clears generated hosted analyses only. It does not remove source documents, exported assets, or saved component decisions. Cache clearing is not a substitute for restarting the gateway after source or configuration changes.
