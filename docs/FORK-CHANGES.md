# Fork Change Notes

## Purpose

This document records intentional fork-local changes so future sync or AI agents can distinguish project-specific work from accidental drift. Do not revert or discard these changes during upstream sync without checking the rationale here first.

## Scope

Compared branch: `re-main` against `main`.

This file also includes the current uncommitted local development/editor fixes that are not yet part of `HEAD`.

## Branch-Level Changes From `main`

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

## Current Uncommitted Local Changes

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

**Rationale:**

Typing `- ` inside a table cell should behave like the regular editor and turn the current line into a bullet list. The default ProseMirror wrapping input rule can wrap the entire table-cell paragraph, which is wrong when a cell has multiple visual lines separated by hard breaks.

**Implementation Notes:**

- Keep the existing default wrapping rule outside table cells.
- Inside table cells and header cells, use a line-aware fallback that converts only the current hard-break-delimited line into a list.
- Preserve text before and after the current line as separate paragraphs in the same cell.
- Add a table-list-specific Backspace handler so undoing an empty list marker in a table cell restores `- ` or `1. ` and keeps the cursor after the marker.

## Verification Used For Current Uncommitted Changes

- `yarn test shared/editor/lib/listInputRule.test.ts`
- `oxlint --type-aware shared/editor/lib/listInputRule.ts shared/editor/lib/listInputRule.test.ts`
- `oxlint --type-aware shared/editor/nodes/ListItem.ts shared/editor/lib/listInputRule.ts shared/editor/lib/listInputRule.test.ts`

## Sync Guidance

- Prefer preserving fork changes that support Railway deployment, AI/MCP editing, table editing APIs, and Windows local development.
- If upstream introduces overlapping document editing or table APIs, compare behavior carefully before replacing fork code.
- Treat files listed under branch-level changes as intentional feature work, not formatting-only churn.
- Re-run focused tests around document editing, table APIs, webhooks, GitLab Markdown, and editor input rules after any upstream sync.
