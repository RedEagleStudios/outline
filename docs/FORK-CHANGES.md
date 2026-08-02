# Fork Change Notes

## Purpose

This document records intentional fork-local changes so future sync or AI agents can distinguish project-specific work from accidental drift. Do not revert or discard these changes during upstream sync without checking the rationale here first.

## Scope

Compared branch: `re-main` against `main`.

This file also records notable branch-level and fork-local development changes that may overlap with upstream during sync.

## Branch-Level Changes From `main`

### Development Editor Stress Harness

The authenticated development-only `/debug/editor-stress` route mounts the production low-level editor with a deterministic, structured in-memory QA fixture. It provides local profiling controls and structural/resource diagnostics. The harness itself creates no documents, persistence, or document-collaboration traffic; the authenticated application shell retains its normal network providers.

### Globally Controlled Frame Viewport Lifecycle Integration

Production iframe gating has one default-off control: public `VIEWPORT_GATED_EMBEDS_ENABLED=false`. No migration or settings UI was added. Legacy stored `viewportGatedEmbeds` team preference keys are ignored. The effective policy requires the primary current-document surface to be eligible, the global control to be true, and no public share. Revisions, presentation, overview, comments, previews, templates, the cache-only Multiplayer Editor, and public shares remain ineligible.

Global environment changes are page-load scoped: existing clients and their NodeViews remain unchanged, while reloaded clients recreate NodeViews under the new global value. Rollback therefore requires setting `VIEWPORT_GATED_EMBEDS_ENABLED=false` and reloading clients. All 14 production custom services that own a `Frame` explicitly forward only allowlisted lifecycle props alongside service-specific frame props and refs. Native video, PDF, images, Drive links, and other non-Frame resources remain excluded.

Each enabled Editor owns an isolated `ViewportResourceBudget` with capacity 8, 100 ms admission dwell, 30-second cooling, FIFO waiting, cooling-LRU pressure eviction, and pinned bypass. Exact lease/authorization/pending tokens enforce committed eviction ordering: revoke authorization, commit iframe removal, release the precise lease in a layout effect, then allow the synchronous replacement grant. Neutral budget metrics are queued with state-after-mutation snapshots and delivered only at stable outer mutation boundaries, including safe observer re-entry and exception isolation. One best-effort privacy-bucketed summary may be emitted per enabled Editor lifetime; telemetry never controls activation or rollback.

The local canary exposed a constructor-order defect when a Yjs plugin dispatched while `new EditorView(...)` was still constructing and document-size telemetry dereferenced the not-yet-assigned class view. Observation now consumes the explicit applied `EditorState`, including constructor-time dispatch, initialization, external replacement, reinitialization, document-changing transactions, and collector replacement. A plugin-constructor dispatch regression covers this ordering.

Authoritative mixed evidence used 18 alternating generic/custom Embed NodeViews sharing one Editor budget. Five dwell sweeps and three fast sweeps kept synchronous DOM-method, MutationObserver live/reconstructed, and rAF maxima at or below 8. All nine generic and nine custom candidates participated, reconstruction divergence was zero, and capacity replacement followed committed removal.

Local production-surface validation passed the default-off baseline, canary-on initialization after the constructor fix, iframe identity retention, no navigation, public-share exclusion, and one SPA-unmount summary. Historical two-client WebSocket live-rollback evidence applied to the removed team preference and is no longer part of the control plane. Following explicit owner approval on 2026-08-02, Railway production was inspected and `VIEWPORT_GATED_EMBEDS_ENABLED=true` was set for global activation.

Genuine hidden-page behavior lasting more than 31 seconds and natural `pagehide` delivery to the operational analytics sink remain unverified production-monitoring and validation items; they are not claimed as completed activation evidence. The rollback procedure and ineligible surface and non-Frame resource exclusions above remain unchanged.

### Large-Document Renderer Groundwork

Large media/table documents avoid repeated dropdown-definition scans through a document-identity `WeakMap`. Temporary upload, dimension-probe, and image-download object URLs are deterministically revoked, legacy upload placeholder React roots are unmounted, and table NodeViews clean up animation frames and scroll listeners deterministically. Document image lazy loading was removed after worsening print readiness; images remain eager, and immediate print blanks also reproduce in the eager baseline.

Initial table geometry now uses one shared rAF with prepare → read all tables → write all tables ordering. No ProseMirror document/DOM content is recycled. Exact alternating evidence measured warm p50 711.6 → 687.5 ms, warm p90 792.9 → 716.1 ms, forced style/layout 260.1 → 218.5 ms, and TableView CPU samples 268 → 29, with no cold regression and 59.37 FPS controlled scrolling. Verification passed 26 focused TableView tests across two shared projects and 56 relevant table tests.

Representative production-scale QA documents contain multiple tables, hundreds of Dropdown NodeViews, and more than one hundred image attachments. In the measured shape, remembered “videos” were primarily ordinary Google Drive hyperlinks rather than loaded media, with few actual Embeds and no native video nodes.

Clean isolation and a full clean-build verification are mandatory before rollout consideration, and no production performance gain is claimed from iframe gating for documents with few actual Embeds.

### Browser-Local Heading Collapse State

**Files:**

- `shared/editor/nodes/Heading.ts`
- `shared/editor/queries/findCollapsedNodes.ts`
- `shared/editor/commands/splitHeading.ts`

**Rationale and implementation notes:**

Heading folding is a personal browser preference and must not alter collaborative document content. Headings default to expanded when no browser-local preference exists. Collapse state now lives in browser storage and position-targeted ProseMirror plugin metadata, so no fold boolean is represented in collaborative content or synchronized through Yjs. Legacy serialized `collapsed` data from server-side document content is accepted as an unknown attribute and ignored/dropped when ProseMirror loads the heading. Document-order duplicate keys keep matching headings independently foldable, and local fold decorations are reconciled after structural document changes so remotely inserted section content remains hidden.

### Current Development: Excalidraw-in-Docs MVP

**Files:**

- `shared/editor/nodes/Excalidraw.tsx`
- `app/editor/components/ExcalidrawDialog.tsx`
- `app/editor/components/ExcalidrawViewer.tsx`
- `app/types/excalidraw.d.ts`
- `shared/editor/nodes/index.ts`
- `server/models/ExcalidrawDrawingRevision.ts`
- `server/routes/api/excalidraw/*`
- `server/presenters/excalidrawDrawingRevision.ts`
- `server/migrations/20260701000000-create-excalidraw-drawing-revisions.js`
- `package.json`

**Rationale:**

The fork adds first-class document-embedded Excalidraw drawings for teams that need lightweight diagrams inside knowledge base pages.

**Implementation Notes:**

- Drawings are stored as immutable `excalidraw_drawing_revisions` rows scoped to a parent document and team; scene access is authorized through the parent document instead of generic attachment redirects.
- Public shared document views may fetch drawing scenes by passing the document `shareId`; the API verifies the drawing revision belongs to the shared document before returning it.
- The MVP rejects non-empty Excalidraw `files` maps, caps scene/element size, and stores only JSON scene data, so embedded image files are intentionally unsupported.
- ProseMirror stores only small drawing pointers and fallback metadata in an atom `excalidraw` block; full scene JSON is not stored in `documents.content`.
- Saving a drawing creates a new drawing revision and clients must update the mounted editor node through a normal editor transaction so document revisions capture pointer changes.
- Markdown/plain-text fallback renders the drawing title when rich rendering is unavailable.
- Viewer and editor surfaces now use clearer loading, empty, and error states, plus a taller modal canvas and edit-only affordances in document view.
- The PWA Workbox precache limit is raised to 6 MiB because the production Mermaid vendor chunk can exceed 5 MiB after the editor bundle changes, causing Railway builds to fail during service worker generation.

### Current Development: Editor Text Color and Size Marks

**Files:**

- `shared/editor/marks/TextColor.ts`
- `shared/editor/marks/TextSize.ts`
- `shared/editor/marks/TextStyle.test.ts`
- `shared/editor/nodes/index.ts`
- `app/editor/components/TextColorPicker.tsx`
- `app/editor/menus/formatting.tsx`

**Rationale:**

The fork adds rich-editor text color and preset text size formatting for teams that need lightweight visual emphasis beyond bold, highlight, and headings.

**Implementation Notes:**

- Text color is stored as a `text_color` mark with validated hex colors, serialized as a span with `data-text-color` and inline `color` style.
- Text size is stored as a `text_size` mark constrained to preset pixel values; choosing Default removes the mark rather than storing a default size.
- Markdown serialization and parsing preserve these marks with safe inline span tokens so server/MCP edits round-trip text styling instead of dropping it.
- Formatting toolbar controls are hidden for code blocks and whole-cell table selections; they remain available for normal cursor or text selections inside table cells.

### Current Development: Editor Content Navigation Improvements

**Files:**

- `app/scenes/Document/components/Contents.tsx`
- `app/menus/TableOfContentsMenu.tsx`
- `app/editor/extensions/FindAndReplace.tsx`
- `app/editor/menus/formatting.tsx`
- `app/editor/menus/tableRow.tsx`
- `app/editor/menus/tableCol.tsx`
- `shared/editor/commands/table.ts`
- `shared/editor/queries/table.ts`
- `shared/editor/extensions/DeleteNearAtom.ts`
- `shared/editor/nodes/Table.ts`

**Rationale:**

The fork improves document navigation by including level-four headings in table-of-contents surfaces and making editor find navigation wait for highlight state before scrolling to the active match.
It also adds row-level and selected-cell table alignment controls so alignment is not only exposed through column actions, and surfaces merge/split cell controls directly in table row and column toolbars.
Whitespace deletion next to inline image atoms is also handled before the browser/editor default can remove the adjacent image.

**Implementation Notes:**

- Heading 4 now appears in the selection formatting toolbar, document contents sidebar, and table-of-contents dropdown.
- Find/replace next and previous navigation schedules scrolling after the editor transaction updates highlight state, preventing stale highlight ranges from blocking auto-scroll.
- Firefox-family browsers use ProseMirror decoration highlights instead of the CSS Custom Highlight API because `::highlight()` rendering is not reliable in Firefox/Zen for this editor surface.
- Table row menus now expose left, center, and right alignment buttons backed by a row-scoped command that updates the selected row’s cell alignment attrs.
- The selection formatting toolbar now exposes left, center, and right alignment for selected table cells.
- Merge and split cell actions now appear as direct row/column toolbar buttons when applicable instead of being hidden inside the More submenu.
- Delete and Backspace remove whitespace between an inline image and following text without deleting the image node.

### Current Development: Inline Document Dropdowns

**Files:**

- `shared/editor/nodes/Dropdown.tsx`
- `shared/editor/nodes/DropdownDefinition.ts`
- `shared/editor/lib/dropdowns.ts`
- `shared/editor/nodes/index.ts`
- `app/editor/components/BlockMenu.tsx`
- `app/editor/menus/block.tsx`
- `server/models/DropdownTemplate.ts`
- `server/routes/api/dropdownTemplates/*`
- `server/presenters/dropdownTemplate.ts`
- `server/policies/dropdownTemplate.ts`
- `server/migrations/20260515000000-create-dropdown-templates.js`

**Rationale:**

The fork adds an MVP Google Docs-style dropdown chip for documents. Dropdowns are inline ProseMirror atom nodes that reference hidden document-level definition nodes, so no database migration is required.

**Implementation Notes:**

- The default `Status` dropdown contains `Design`, `Open Issue`, `In Progress`, `QA`, `Solved`, `Ignored`, and `Ready To Test` options.
- Dropdown definitions are stored in hidden `dropdown_definition` nodes; chips store `dropdownId` and `selectedOptionId`.
- The slash menu exposes workspace dropdown types under `Dropdown` and includes `New workspace dropdown...` and editor/admin `Edit workspace dropdown...` form flows with color pickers for option colors. Legacy document-local dropdowns remain readable in existing documents but are hidden from the insertion menu.
- Workspace dropdown templates are stored per team and copied into documents when inserted so document Markdown remains portable.
- Markdown serialization writes definitions as `<!-- outline-dropdown {...} -->` comments and chips as `{dropdown:status|open}`.
- Legacy MVP chips with per-node `options` attrs remain readable as a fallback during transition.

### Current Development: OpenCode AI Formatting Helper

**Files:**

- `app/editor/components/AITextFormatter.tsx`
- `app/editor/components/FloatingToolbar.tsx`
- `app/editor/components/SelectionToolbar.tsx`
- `app/editor/components/ToolbarMenu.tsx`
- `app/editor/menus/formatting.tsx`
- `Dockerfile`
- `server/routes/api/ai/*`
- `server/services/ai/*`
- `server/env.ts`

**Rationale:**

The fork adds an editor selection helper that lets users select text, enter an instruction, and ask a server-side OpenCode CLI provider to rewrite only that selected text. This supports Railway deployments by allowing OpenCode working/config directories to point at persistent volume paths.

**Implementation Notes:**

- Enable with `AI_FORMATTING_ENABLED=true` and `AI_FORMATTING_PROVIDER=opencode`.
- Configure OpenCode with `OPENCODE_COMMAND`, optional `OPENCODE_DIR`, `OPENCODE_CONFIG_DIR`, `OPENCODE_MODEL`, `OPENCODE_AGENT`, and `OPENCODE_ATTACH`. Set `OPENCODE_DIR` on Railway when the OpenCode working directory should live on a persistent volume.
- The Docker runtime installs the `opencode-ai` CLI and defaults OpenCode runtime/config paths under `/var/lib/outline` so Railway deployments can enable AI formatting with environment variables and, optionally, a persistent volume.
- The API route is authenticated and rate-limited, validates prompt and selected text length, and invokes `opencode run` server-side via `spawn` with ignored stdin to avoid hanging subprocesses.
- The editor shows a rendered Markdown diff preview with explicit Accept/Decline actions, and replaces the original selected range only if the selected text still matches the text submitted to the provider.
- The AI formatter popup is draggable from its dotted handle so long previews can be moved away from the selected content.

### Current Development: Editor Undo Shortcut De-Duplication

**Files:**

- `app/scenes/Document/components/Document.tsx`
- `shared/editor/extensions/History.ts`

**Rationale:**

The fork prevents one `Ctrl/Cmd+Z` keypress from triggering both the ProseMirror history keymap and the document-level global undo shortcut. Without this guard, one undo could create two redo steps and feel unpredictable.

**Implementation Notes:**

- ProseMirror undo/redo key handlers now return `true` after invoking the editor command so the keymap reports the shortcut as handled.
- The document-level undo/redo shortcut exits when the browser event was already handled by the editor.

### Current Development: Image Drag Move Behavior

**Files:**

- `shared/editor/nodes/Image.tsx`
- `shared/editor/components/Image.tsx`
- `shared/editor/plugins/UploadPlugin.ts`
- `app/components/Editor.tsx`

**Rationale:**

The fork restores Google Docs-style image movement in the editor. Native browser image dragging was being treated as an external image drop, so dragging an existing image duplicated it instead of moving the original node.

**Implementation Notes:**

- The ProseMirror image node is draggable so internal drag/drop owns the move transaction.
- Rendered `<img>` elements opt out of native browser dragging so the browser does not provide an external image payload for the drop.
- Upload handling ignores ProseMirror's own `data-pm-slice` drag payloads and tracks drags that start inside the editor so CDN-backed image URLs are not re-uploaded as copies during an internal move.
- If an internal image drag lands where ProseMirror cannot compute a drop point, the drop is cancelled before the browser's native contenteditable fallback can insert a copy.
- The outer editor padding drop zone ignores active ProseMirror drags instead of parsing their drag HTML and appending a duplicate image at the end of the document.

### 1. Railway And Container Compatibility

**Files:**

- `Dockerfile`
- `.gitignore`
- `server/storage/files/LocalStorage.ts`

**Rationale:**

The fork is deployed on Railway, so the container build and runtime assumptions differ from upstream. The branch includes fixes to build from source instead of pulling the upstream `outline-base` image and removes Docker `VOLUME` behavior that conflicts with Railway-managed volumes.

**Implementation Notes:**

- Keep Railway-specific Docker changes when syncing upstream.
- Local storage upload behavior was adjusted to support signed presigned POST semantics while still using local storage.

### 2. AI-Agent-Friendly Document Editing API

**Files:**

- `docs/AI_EDITING.md`
- `server/routes/api/documents/documents.ts`
- `server/routes/api/documents/schema.ts`
- `server/routes/api/documents/documents.test.ts`
- `server/tools/documents.ts`
- `server/models/helpers/DocumentHelper.tsx`
- `server/models/helpers/ProsemirrorHelper.tsx`
- `server/routes/mcp/index.ts`

**Rationale:**

The fork exposes safer, structured document-editing surfaces for AI agents and MCP clients. These changes are intended to avoid full-document Markdown round-trips when rich ProseMirror attributes need to be preserved.

**Implementation Notes:**

- Preserve APIs for surgical edits, ProseMirror JSON inspection, block-level updates, and multi-patch operations.
- Keep warnings around styling loss when Markdown replacement would discard table or node-level attributes.
- Treat these endpoints/tools as part of the fork’s AI workflow, not temporary debug code.

### 3. Table API And MCP Table Tools

**Files:**

- `server/routes/api/tables/index.ts`
- `server/routes/api/tables/schema.ts`
- `server/routes/api/tables/tables.ts`
- `server/routes/api/tables/tables.test.ts`
- `server/tools/tables.ts`
- `server/routes/api/index.ts`
- `server/routes/mcp/index.ts`

**Rationale:**

The fork supports structured table operations through API and MCP tooling so agents can edit table cell backgrounds, column widths, table layout, and merged cells without replacing whole documents.

**Implementation Notes:**

- Keep API and MCP tools aligned with ProseMirror table attributes.
- Preserve tests for table cell background, column width, layout, merge, and split behavior.

### 4. Document History And Revision Comparison

**Files:**

- `app/scenes/Document/components/History/*`
- `app/scenes/Document/components/RevisionViewer.tsx`
- `app/scenes/Document/components/Document.tsx`
- `app/scenes/Document/hooks/useDocumentSave.ts`
- `server/routes/api/documents/documents.ts`
- `server/routes/api/documents/schema.ts`
- `server/commands/documentUpdater.ts`
- `server/commands/documentUpdater.test.ts`

**Rationale:**

The branch adds richer document history behavior, including comparing arbitrary revisions and showing highlighted changes.

**Implementation Notes:**

- History-related components were moved under `app/scenes/Document/components/History/`.
- `useDocumentSave` separates save behavior from the main document component.
- Preserve server-side revision comparison and document updater tests during sync.

### 5. Sidebar Refactor And Navigation Controls

**Files:**

- `app/components/Sidebar/Aside.tsx`
- `app/components/Sidebar/Sidebar.tsx`
- `app/components/Sidebar/components/CollectionRow.tsx`
- `app/components/Sidebar/components/DocumentRow.tsx`
- `app/components/Sidebar/components/CollectionLink.tsx`
- `app/components/Sidebar/components/DocumentLink.tsx`
- `app/components/Sidebar/components/StarredLink.tsx`
- `app/components/Sidebar/components/SharedWithMeLink.tsx`
- `app/actions/definitions/navigation.tsx`

**Rationale:**

The sidebar was refactored to extract reusable row components, improve starred document controls, and adjust navigation behavior.

**Implementation Notes:**

- `Right.tsx` was renamed to `Aside.tsx`.
- `CollectionRow` and `DocumentRow` are intentional abstractions, not duplicate UI.
- Keep the starred/shared/collection row behavior changes together when resolving upstream conflicts.

### 6. Editor Table And Decoration Performance Work

**Files:**

- `shared/editor/nodes/TableCell.ts`
- `shared/editor/nodes/TableHeader.ts`
- `shared/editor/nodes/TableRow.ts`
- `shared/editor/nodes/TableView.ts`
- `shared/editor/commands/table.ts`
- `shared/editor/plugins/FixTablesPlugin.ts`
- `shared/editor/plugins/PlaceholderPlugin.ts`
- `shared/editor/plugins/TableLayoutPlugin.ts`
- `shared/editor/plugins/CodeWordDecorationsPlugin.ts`
- `shared/editor/lib/transactionChangesTableStructure.ts`
- `shared/editor/lib/transactionTouchesNodeTypes.ts`
- `shared/editor/lib/shouldRebuildTableControlDecorations.ts`

**Rationale:**

The branch reduces unnecessary editor decoration rebuilds and improves table behavior, including layout handling and cell/header controls.

**Implementation Notes:**

- Preserve helper utilities that detect whether transactions touch table structure or relevant node types.
- Table decoration optimizations are performance-oriented and should not be removed just because upstream code looks simpler.
- `Tab` indents a non-empty text selection inside a single table cell before falling back to cell navigation for cursor and cell selections.
- Table-structure detection inspects each transaction step against its recorded pre-step document, preventing stale-coordinate crashes when append-transaction plugins target content added earlier in the chain.

### 7. Webhook Payload Change Inclusion

**Files:**

- `plugins/webhooks/server/api/schema.ts`
- `plugins/webhooks/server/api/webhookSubscriptions.ts`
- `plugins/webhooks/server/presenters/webhook.ts`
- `plugins/webhooks/server/presenters/webhookSubscription.ts`
- `plugins/webhooks/server/tasks/DeliverWebhookTask.ts`
- `plugins/webhooks/server/tasks/DeliverWebhookTask.test.ts`
- `server/migrations/20260418000000-add-include-changes-to-webhook-subscription.js`
- `server/models/WebhookSubscription.ts`

**Rationale:**

Webhook subscriptions can include document changes in delivered payloads. This is backed by a migration and tests.

**Implementation Notes:**

- Keep the migration with the model/API/task changes.
- Preserve presenter changes so clients can see and configure the new subscription option.

### 8. GitLab Flavored Markdown Handling

**Files:**

- `plugins/gitlab/server/gitlab.ts`
- `plugins/gitlab/shared/GitLabUtils.ts`
- `plugins/gitlab/shared/GitLabUtils.test.ts`

**Rationale:**

The fork improves GitLab Flavored Markdown handling for GitLab integration content.

**Implementation Notes:**

- Keep utility tests with parser/formatting changes.

### 9. Email Delivery Via Resend HTTP API

**Files:**

- `server/emails/mailer.tsx`
- `server/env.ts`

**Rationale:**

The branch adds a Resend HTTP API transport for environments where SMTP is blocked or unreliable.

**Implementation Notes:**

- Preserve Resend env handling with mailer changes.
- This is deployment-support functionality, not unused alternate mail code.

### 10. RTL And Language Utilities

**Files:**

- `shared/utils/rtl.ts`
- `app/utils/language.ts`
- `app/utils/i18n.ts`
- `shared/i18n/locales/en_US/translation.json`
- Multiple UI components using direction-aware layout tweaks.

**Rationale:**

The branch adds right-to-left layout support and related language helpers.

**Implementation Notes:**

- Keep direction-aware UI adjustments with the shared RTL utility.

### 11. React Refactors And UI Cleanup

**Files:**

- `app/scenes/Document/components/Document.tsx`
- `app/components/WebsocketProvider.tsx`
- `app/components/withStores.tsx`
- Multiple common UI components under `app/components/`.

**Rationale:**

The branch includes refactors converting large components to modern functional patterns and removing older helper patterns.

**Implementation Notes:**

- `withStores.tsx` deletion is intentional.
- `WebsocketProvider` and `Document` refactors should be treated as structural changes rather than superficial formatting.

## Additional Branch-Level Changes

### 12. Windows-Compatible Backend Build Cleanup And Copies

**Files:**

- `build.js`

**Rationale:**

The Makefile `up` target runs `yarn dev:watch` on the host after starting Redis and Postgres in Docker. On Windows, the backend build failed because `build.js` used Unix shell commands such as `rm -rf`, `cp`, and `mkdir -p`. These commands are not available in a standard Windows command shell.

**Implementation Notes:**

- Use Node `fs/promises` APIs for removing and copying build artifacts.
- Use retry options for recursive removal because Windows may briefly report `ENOTEMPTY` while files are still being released.
- Keep Babel compilation commands unchanged.

### 13. Cross-Platform Plugin Glob Loading

**Files:**

- `server/utils/PluginManager.ts`

**Rationale:**

On Windows, `path.join(rootDir, "plugins/*/server/!(*.test|schema).[jt]s")` produced backslash-separated glob patterns. The glob package did not match the built plugin files with that pattern, so auth providers such as Discord were not loaded locally.

**Implementation Notes:**

- Use `path.posix.join` for the glob pattern only.
- The subsequent `require(path.join(process.cwd(), filePath))` remains the normal platform-specific filesystem path.
- Linux behavior is unchanged because Linux `path.join` already produced `/`.

### 14. List Input Rules Inside Table Cells

**Files:**

- `shared/editor/lib/listInputRule.ts`
- `shared/editor/lib/listInputRule.test.ts`
- `shared/editor/nodes/ListItem.ts`
- `shared/editor/nodes/ListItem.test.ts`
- `shared/editor/nodes/CheckboxItem.ts`

**Rationale:**

Typing `- ` inside a table cell should behave like the regular editor and turn the current line into a bullet list. The default ProseMirror wrapping input rule can wrap the entire table-cell paragraph, which is wrong when a cell has multiple visual lines separated by hard breaks.

**Implementation Notes:**

- Keep the existing default wrapping rule outside table cells.
- Inside table cells and header cells, use a line-aware fallback that converts only the current hard-break-delimited line into a list.
- Preserve text before and after the current line as separate paragraphs in the same cell.
- Add a table-list-specific Backspace handler so undoing an empty bullet list marker in a table cell restores `- ` and keeps the cursor after the marker.
- Empty ordered-list items use Backspace to reduce nesting; at the root list level they become regular paragraphs.
- Empty list items with nested child lists use Backspace to remove the empty parent and promote child items up one level.
- `Tab`, `Shift-Tab`, `Mod-]`, and `Mod-[` apply list nesting changes to every list item touched by a non-empty text selection instead of only the first selected item.

## Verification Used For List Input Rule Changes

- `yarn test shared/editor/lib/listInputRule.test.ts`
- `oxlint --type-aware shared/editor/lib/listInputRule.ts shared/editor/lib/listInputRule.test.ts`
- `oxlint --type-aware shared/editor/nodes/ListItem.ts shared/editor/lib/listInputRule.ts shared/editor/lib/listInputRule.test.ts`

## Sync Guidance

- Prefer preserving fork changes that support Railway deployment, AI/MCP editing, table editing APIs, and Windows local development.
- If upstream introduces overlapping document editing or table APIs, compare behavior carefully before replacing fork code.
- Treat files listed under branch-level changes as intentional feature work, not formatting-only churn.
- Re-run focused tests around document editing, table APIs, webhooks, GitLab Markdown, and editor input rules after any upstream sync.
