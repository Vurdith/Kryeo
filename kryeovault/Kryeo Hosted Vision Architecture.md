# Kryeo Hosted Vision Architecture

## Decision

Use a two-stage intelligence system:

1. **Local fast pass**
   - Reads the Affinity hierarchy and metadata.
   - Creates previews and visual hashes.
   - Detects exact duplicates.
   - Uses MobileCLIP only for cheap visual embeddings and broad candidate retrieval.
   - Sends confident, obvious results directly to review.

2. **Hosted reasoning pass**
   - Runs on the RTX 4070 SUPER.
   - Receives only uncertain, conflicting, poorly named, or structurally complicated candidates.
   - Uses a multimodal language model to inspect the preview together with hierarchy, sibling, parent, size, and document context.
   - Returns structured suggestions rather than directly changing the document.

This preserves fast scans and low bandwidth while adding real visual reasoning where it matters.

## Model Plan

### Default service

`Qwen3-VL-4B-Instruct`, quantized for NVIDIA inference.

This is the best first target because it is designed for visual reasoning, GUI understanding, language, and tool use while leaving useful headroom on a 12 GB GPU.

### Quality lane

`Qwen3-VL-8B-Instruct`, 4-bit quantized.

Use this as an optional slower pass for especially ambiguous components. It should be queued with very low concurrency because images, context, and the KV cache consume memory in addition to model weights.

## Request Contract

Kryeo sends:

- A fitted full-component preview.
- Optional detail crops chosen from visual saliency, not fixed tiles.
- Layer name and node type.
- Bounds and document-relative position.
- Parent, siblings, and selected child summaries.
- Transparency and geometry measurements.
- Local candidate types and confidence.
- Similar learned examples from the current project.

The server returns:

```json
{
  "displayName": "Ornate Gold Hotbar Slot",
  "assetType": "Slot",
  "robloxRole": "ImageButton",
  "confidence": 0.91,
  "reason": "A repeated framed receptacle inside a hotbar container.",
  "alternatives": [
    { "assetType": "Button", "confidence": 0.35 }
  ],
  "groupDive": {
    "recommendation": "children",
    "confidence": 0.84,
    "reason": "The parent contains repeated independently reusable slots."
  }
}
```

The client validates this schema. The model never receives permission to execute arbitrary Affinity actions.

## Learning

Corrections are stored per project as examples, not permanent hardcoded rules:

- Preview embedding and visual hash.
- Relevant hierarchy context.
- Previous suggestion.
- User correction.
- Scope: project, library, or global.

Future scans retrieve the closest corrections and show them to the hosted model as context. Users can inspect, edit, disable, and delete these learning records.

## Service Boundaries

- Run the inference worker separately from Kryeo.
- Put an authenticated HTTPS API in front of it.
- Never expose the raw model server port.
- Issue revocable tokens per user or installation.
- Queue requests and cap image dimensions, batch size, and scan frequency.
- Cache by preview hash plus context fingerprint.
- Delete uploaded previews after inference unless the user explicitly enables learning storage.
- Fall back to the local pass when the service is unavailable.

## Capacity Reality

An RTX 4070 SUPER is suitable for development, private testing, and an early beta. It is not an unlimited public inference service. The 4B model should be the normal path; the 8B model should be a queued quality path. Gaming or rendering on the same GPU will compete with inference.

## Implementation Order

1. Preserve the 0.13.4 runtime as the known-good baseline.
2. Build the model server as an independent service.
3. Add a local mock client and validate the request/response schema.
4. Test a fixed evaluation set against 0.13.4 naming and classification.
5. Integrate behind a feature flag.
6. Add learning records and their management screen.
7. Invite a small beta only after accuracy and disconnect behavior are measured.
