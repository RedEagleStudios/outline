# AI-Driven Document Editing

This document captures the motivation, use case, and proposed fork changes to make Outline a first-class target for AI agents that programmatically edit documents.

## Use Case

We migrated a large Google Docs GDD (~2800 lines of markdown, 245 embedded images, 15 tabs) into an Outline collection using the public API. During this migration, an AI agent repeatedly needed to:

1. Fix formatting issues (missing spaces around bold markers, run-on sentences, inline image crammed in cells, Google-Docs-style merged-cell header rows, pandoc `{#anchor}` leftovers).
2. Split long flat tables into readable sections (one logical unit per row, with `<br>` paragraph breaks inside cells).
3. Preserve manual UI edits the human user had already made (table background colors, per-image size overrides `=WIDTHxHEIGHT`, "full width" table toggle, merged cells, row span adjustments).

The goal: let the agent fix content programmatically **without** clobbering UI-only attributes the human set in the editor.

## Observed Friction

Working only through `documents.update` + `documents.import` + `documents.info` we hit several pain points:

### 1. Markdown is lossy

Table cell background color, column widths, image dimension overrides, merged cells, and the "full width" flag are not expressible in standard markdown. Any `editMode: "replace"` destroys all of them across the entire document.

### 2. Two serializers disagree

`documents.info` returns markdown produced by one serializer; `editMode: "patch"` (introduced in [#11987](https://github.com/outline/outline/pull/11987)) matches `findText` against markdown produced by a *different* serializer internally. The differences are small but consequential:

- Smart-typography quotes: `'` vs `\u2019` (right single quote), `"` vs `\u201C`/`\u201D`.
- Escape rules for characters like `[`, `]`, `|`, `-` inside table cells.
- Table cell padding/whitespace.
- Link title encoding.

Result: an agent fetches markdown, plans a change, and the patch fails because the round-trip doesn't preserve bytes.

### 3. Per-cell history matters

Outline's editor auto-converts typed `'` to `\u2019`. Cells that a human touched end up with curly quotes; cells from a bulk markdown import keep straight quotes. Within a single document, identical-looking apostrophes can require different `findText` representations depending on whether the human ever edited that specific cell.

### 4. No node-level addressing

There is no stable identifier for a ProseMirror block or table cell in the public API. Everything must be reached by markdown substring match, which forces agents to invent disambiguating context on every edit.

### 5. `editMode: "patch"` matches first occurrence only

When a short `findText` appears multiple times, the agent has no way to target occurrence N other than expanding `findText` with surrounding context until unique, which compounds the serializer-mismatch problem above.

### 6. Collaboration state is out of band

Outline's UI edits flow through a Yjs CRDT WebSocket, separate from the REST API. The REST API can neither read nor apply CRDT transactions, so structural ops available in the UI (merge cells, set cell color, resize column) are unreachable from automation.

## Goal

Make it possible for an AI agent to:

- Read a document's **full structural state**, including attributes that don't serialize to markdown.
- Apply **surgical edits** identified by stable anchors (node IDs, PM paths), not just string find/replace.
- Round-trip the document through the API without losing UI-only state.

## Proposed Changes (Ranked)

### High impact, low effort

**1. `documents.data` endpoint** — Returns the ProseMirror JSON of the published document, not just markdown. Lets the agent see table `attrs` (background color, width, colspan/rowspan), image attrs (alt, width, height), and any other node-level metadata. Additive, read-only, no breakage risk.

**2. Unify the markdown serializer** — Make `documents.info` / `documents.export` use the same serializer that `editMode: "patch"` uses internally. Kills the `findText` mismatch class entirely. Likely a one-file change in `DocumentHelper`.

**3. Optional smart-typography off-switch** — Per-team setting, per-request flag, or per-document opt-out that disables auto-conversion of `'` → `\u2019`, `...` → `\u2026`, `--` → `\u2014`. Makes quote handling deterministic for bulk imports.

### Medium effort, high payoff

**4. Accept ProseMirror JSON in `documents.update`** — New `data` field on the `update` endpoint, mutually exclusive with `text`. Agents can round-trip the full doc structure without serializing through markdown and losing attributes. `data` takes precedence if both are supplied.

**5. Node-level API** — Two companion endpoints:
- `documents.blocks.list(id)` returns an array of ProseMirror nodes with stable IDs (either existing PM node marks or a new server-assigned ID that persists across edits).
- `documents.blocks.update(documentId, blockId, data | text)` replaces a single block by its ID, preserving all surrounding attributes.

This is the surgical surface agents really want.

**6. Atomic multi-patch** — `documents.update` accepts `patches: [{ findText, text }...]` applied as a single ProseMirror transaction. Avoids the "doc re-serializes between my two patches and my second `findText` no longer matches" failure mode.

### Nice to have

**7. PM-diff webhook payload** — On `documents.update` events, include the ProseMirror step diff (or a structural JSON diff) alongside the current `data.title`/`data.done` summary. Lets AI agents react to real content changes instead of guessing.

**8. Explicit cell-level table ops** — `tables.mergeCells`, `tables.splitCell`, `tables.setCellBackground`, `tables.setColumnWidth`. Named operations for editor-only features markdown can't express.

**9. Helpful `findText` errors** — On "text not found" from `editMode: "patch"`, return the closest substring that *does* exist, the character-level diff, or the nearest N matches. Example:
```json
{
  "error": "findText_not_found",
  "suggestions": [
    { "offset": 31228, "text": "player\u2019s head", "distance": 1 }
  ]
}
```
Reduces debugging from "retry and binary search" to "fix and retry".

## Non-Goals

- Replacing the markdown API. Markdown remains the primary plain-text interface.
- Exposing the Yjs CRDT protocol externally. That is the editor's transport, not an API contract.
- Adding AI-specific inference endpoints (summarize, rewrite, etc.). This document is about **editing infrastructure**, not AI model features.

## Success Criteria

A document with merged cells, a coloured background, custom column widths, and per-image resize overrides can be round-tripped through the API without loss:

1. `GET documents.data` → full PM JSON with all attrs.
2. Agent mutates one cell's text.
3. `PUT documents.blocks.update` with the changed block.
4. Re-fetch `documents.data` — all other cells retain their attrs byte-for-byte; only the edited cell's text changed.

Additionally, `editMode: "patch"` with a `findText` copied verbatim from `documents.info` output should always match (no serializer drift).
