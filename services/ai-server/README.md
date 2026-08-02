# Kryeo AI Server

This service places authentication, rate limits, interactive and background queues, family-result caching, and strict request limits in front of an OpenAI-compatible Qwen3.5-9B model server.

It does not save uploaded source images. The persistent cache contains only structured family results keyed by a visual-family fingerprint.

## Development

1. Run a Qwen3.5-9B multimodal server on `http://127.0.0.1:8080/v1`.
2. Copy `.env.example` to `.env` and edit its values.
3. Generate an access token with `npm run token`.
4. Start the gateway with `npm start`.
5. Configure Kryeo to use `http://127.0.0.1:8787` and the generated token.

The gateway intentionally binds to loopback by default. Do not expose the raw model server or this development listener directly to the internet. A public deployment must terminate HTTPS at a reverse proxy and provide independently revocable user tokens.

`scripts/start-qwen.ps1` provides the recommended local `llama-server` launch flags for the initial RTX 4070 SUPER host.

## Production Shape

- Keep at least one inference replica warm.
- Route `/v1/chat` separately from document jobs.
- Scale replicas from queue depth and measured latency.
- Store tokens in a database as hashes when accounts are introduced.
- Replace the single-process rate limiter with a shared store before adding multiple gateway replicas.
