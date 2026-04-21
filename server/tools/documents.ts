import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import documentCreator from "@server/commands/documentCreator";
import documentMover from "@server/commands/documentMover";
import documentUpdater from "@server/commands/documentUpdater";
import { Op } from "sequelize";
import { Collection, Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { sequelize } from "@server/storage/database";
import { authorize } from "@server/policies";
import { presentDocument, presentNavigationNode } from "@server/presenters";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import { UrlHelper } from "@shared/utils/UrlHelper";
import {
  error,
  success,
  buildAPIContext,
  buildSiblingIndexMap,
  getActorFromContext,
  pathToUrl,
  withTracing,
} from "./util";
import { TextEditMode } from "@shared/types";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import SearchProviderManager from "@server/utils/SearchProviderManager";

const patchSchema = z.object({
  findText: z
    .string()
    .describe(
      "The exact markdown substring to find in the document. Copy verbatim from the document's existing markdown; the first occurrence will be replaced."
    ),
  text: z.string().describe("The replacement markdown for the matched text."),
});

/**
 * Registers document-related MCP tools on the given server, filtered by
 * the OAuth scopes granted to the current token.
 *
 * @param server - the MCP server instance to register on.
 * @param scopes - the OAuth scopes granted to the access token.
 */
export function documentTools(server: McpServer, scopes: string[]) {
  if (AuthenticationHelper.canAccess("documents.list", scopes)) {
    server.registerTool(
      "list_documents",
      {
        title: "Search documents",
        description:
          "Searches documents the user has access to. Performs full-text search across document content when a query is provided, or lists recent documents when no query is given. Optionally filter by collection. To retrieve the full contents or hierarchy of a specific collection, use list_collection_documents instead.",
        annotations: {
          idempotentHint: true,
          readOnlyHint: true,
        },
        inputSchema: {
          query: z
            .string()
            .optional()
            .describe(
              "A search query to find documents by content or title. When omitted, returns recent documents."
            ),
          collectionId: z
            .string()
            .optional()
            .describe("An optional collection ID to filter documents by."),
          offset: z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .describe("The pagination offset. Defaults to 0."),
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe(
              "The maximum number of results to return. Defaults to 25, max 100."
            ),
        },
      },
      withTracing(
        "list_documents",
        async ({ query, collectionId, offset, limit }, extra) => {
          try {
            const user = getActorFromContext(extra);
            const effectiveOffset = offset ?? 0;
            const effectiveLimit = limit ?? 25;

            let indexMap: Map<string, number> | undefined;

            if (collectionId) {
              const collection = await Collection.findByPk(collectionId, {
                userId: user.id,
                includeDocumentStructure: true,
              });
              authorize(user, "readDocument", collection);

              if (collection?.documentStructure) {
                indexMap = buildSiblingIndexMap(collection.documentStructure);
              }
            }

            if (query) {
              const searchProvider = SearchProviderManager.getProvider();

              // If the query looks like a document ID or urlId, try direct
              // lookup first so exact matches appear at the top of results.
              let exactMatch: Document | null = null;
              if (UrlHelper.SLUG_URL_REGEX.test(query)) {
                exactMatch = await Document.findByPk(query, {
                  userId: user.id,
                });
                if (
                  exactMatch &&
                  collectionId &&
                  exactMatch.collectionId !== collectionId
                ) {
                  exactMatch = null;
                }
              }

              const { results } = await searchProvider.searchForUser(user, {
                query,
                collectionId,
                offset: effectiveOffset,
                limit: effectiveLimit,
              });

              const presented = await Promise.all(
                results
                  .filter((result) => result.document.id !== exactMatch?.id)
                  .map(async (result) => {
                    const doc = pathToUrl(
                      user.team,
                      await presentDocument(undefined, result.document, {
                        includeData: false,
                        includeText: false,
                      })
                    );
                    const siblingIndex = indexMap?.get(result.document.id);
                    return {
                      ...doc,
                      context: result.context,
                      ...(siblingIndex !== undefined && {
                        index: siblingIndex,
                      }),
                    };
                  })
              );

              if (exactMatch) {
                const doc = pathToUrl(
                  user.team,
                  await presentDocument(undefined, exactMatch, {
                    includeData: false,
                    includeText: false,
                  })
                );
                const siblingIndex = indexMap?.get(exactMatch.id);
                presented.unshift({
                  ...doc,
                  context: undefined,
                  ...(siblingIndex !== undefined && { index: siblingIndex }),
                });
              }

              return success(presented);
            }

            const collectionIds = collectionId
              ? [collectionId]
              : await user.collectionIds();

            const documents = await Document.findAll({
              where: {
                teamId: user.teamId,
                collectionId: collectionIds,
                archivedAt: { [Op.eq]: null },
                deletedAt: { [Op.eq]: null },
              },
              order: [["updatedAt", "DESC"]],
              offset: effectiveOffset,
              limit: effectiveLimit,
            });

            const presented = await Promise.all(
              documents.map(async (document) => {
                const result = pathToUrl(
                  user.team,
                  await presentDocument(undefined, document, {
                    includeData: false,
                    includeText: false,
                  })
                );
                const siblingIndex = indexMap?.get(document.id);
                if (siblingIndex !== undefined) {
                  result.index = siblingIndex;
                }
                return result;
              })
            );
            return success(presented);
          } catch (message) {
            return error(message);
          }
        }
      )
    );
  }

  if (AuthenticationHelper.canAccess("collections.documents", scopes)) {
    server.registerTool(
      "list_collection_documents",
      {
        title: "List all documents in a collection",
        description:
          "Returns the complete hierarchical tree of published documents in a collection, including nested sub-documents. Use this to enumerate every document in a collection or to understand parent/child relationships. Drafts and archived documents are not included.",
        annotations: {
          idempotentHint: true,
          readOnlyHint: true,
        },
        inputSchema: {
          collectionId: z
            .string()
            .describe(
              "The ID of the collection whose document tree to return."
            ),
        },
      },
      withTracing(
        "list_collection_documents",
        async ({ collectionId }, extra) => {
          try {
            const user = getActorFromContext(extra);

            const collection = await Collection.findByPk(collectionId, {
              userId: user.id,
              rejectOnEmpty: true,
            });
            authorize(user, "readDocument", collection);

            const documentStructure = await CacheHelper.getDataOrSet(
              RedisPrefixHelper.getCollectionDocumentsKey(collection.id),
              async () =>
                (
                  await Collection.findByPk(collection.id, {
                    attributes: ["documentStructure"],
                    includeDocumentStructure: true,
                    rejectOnEmpty: true,
                  })
                ).documentStructure,
              60
            );

            const tree = (documentStructure ?? []).map((node) =>
              presentNavigationNode(user.team, node)
            );
            return success(tree);
          } catch (message) {
            return error(message);
          }
        }
      )
    );
  }

  if (AuthenticationHelper.canAccess("documents.create", scopes)) {
    server.registerTool(
      "create_document",
      {
        title: "Create document",
        description:
          "Creates a new document. Requires a collectionId to place the document in a collection, or parentDocumentId to nest it under an existing document. NOTE: `text` is parsed as markdown, which cannot express node-level attributes like table cell background color, column widths, image dimensions, or table full-width layout. If you need those preserved on initial creation, pass a full ProseMirror JSON document via update_document with `data` immediately after creating.",
        annotations: {
          idempotentHint: false,
          readOnlyHint: false,
        },
        inputSchema: {
          title: z.string().describe("The title of the document."),
          text: z
            .string()
            .optional()
            .describe("The markdown content of the document."),
          collectionId: z
            .string()
            .optional()
            .describe("The collection to place the document in."),
          parentDocumentId: z
            .string()
            .optional()
            .describe("The parent document ID to nest this document under."),
          icon: z
            .string()
            .optional()
            .describe("An icon for the document, e.g. an emoji."),
          color: z
            .string()
            .optional()
            .describe("The hex color for the document icon, e.g. #FF0000."),
          publish: z
            .boolean()
            .optional()
            .describe(
              "Whether to publish the document. Defaults to true. Set to false to create as a draft."
            ),
          fullWidth: z
            .boolean()
            .optional()
            .describe(
              "Whether the document should render in full-width mode. Defaults to false."
            ),
        },
      },
      withTracing("create_document", async (input, context) => {
        try {
          const { collectionId, parentDocumentId } = input;
          const ctx = buildAPIContext(context);
          const { user } = ctx.state.auth;
          let collection;
          let parentDocument;

          if (parentDocumentId) {
            parentDocument = await Document.findByPk(parentDocumentId, {
              userId: user.id,
            });

            if (parentDocument?.collectionId) {
              collection = await Collection.findByPk(
                parentDocument.collectionId,
                { userId: user.id }
              );
            }

            authorize(user, "createChildDocument", parentDocument, {
              collection,
            });
          } else if (collectionId) {
            collection = await Collection.findByPk(collectionId, {
              userId: user.id,
            });
            authorize(user, "createDocument", collection);
          }

          const document = await documentCreator(ctx, {
            title: input.title,
            text: input.text,
            icon: input.icon,
            color: input.color,
            parentDocumentId: parentDocumentId,
            publish: input.publish !== false,
            collectionId: collection?.id,
            fullWidth: input.fullWidth,
          });

          const { text, ...attributes } = await presentDocument(
            undefined,
            document,
            {
              includeData: false,
              includeText: true,
              includeUpdatedAt: true,
            }
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(pathToUrl(user.team, attributes)),
              },
              {
                type: "text" as const,
                text: String(text ?? ""),
              },
            ],
          } satisfies CallToolResult;
        } catch (message) {
          return error(message);
        }
      })
    );
  }

  if (AuthenticationHelper.canAccess("documents.move", scopes)) {
    server.registerTool(
      "move_document",
      {
        title: "Move document",
        description:
          "Moves a document to a different location or reorders it within its current parent. Provide a collectionId to move to the root of a collection, a parentDocumentId to nest under another document, and/or an index to control position among siblings.",
        annotations: {
          idempotentHint: false,
          readOnlyHint: false,
        },
        inputSchema: {
          id: z
            .string()
            .describe("The unique identifier of the document to move."),
          collectionId: z
            .string()
            .optional()
            .describe(
              "The destination collection ID. Required if parentDocumentId is not provided."
            ),
          parentDocumentId: z
            .string()
            .optional()
            .describe(
              "The ID of the document to nest this document under. The document will be moved to the parent's collection."
            ),
          index: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              "The zero-based position to insert the document among its siblings. Use this to reorder documents within the same collection and parent. Omit to place at the end."
            ),
        },
      },
      withTracing("move_document", async (input, context) => {
        try {
          const ctx = buildAPIContext(context);
          const { user } = ctx.state.auth;

          return await sequelize.transaction(async (transaction) => {
            ctx.state.transaction = transaction;
            ctx.context.transaction = transaction;

            const document = await Document.findByPk(input.id, {
              userId: user.id,
              rejectOnEmpty: true,
              transaction,
            });

            authorize(user, "move", document);

            let collectionId = input.collectionId;

            if (input.parentDocumentId) {
              if (input.parentDocumentId === input.id) {
                return error("Cannot nest a document inside itself");
              }

              const parent = await Document.findByPk(input.parentDocumentId, {
                userId: user.id,
                rejectOnEmpty: true,
                transaction,
              });

              authorize(user, "update", parent);
              collectionId = parent.collectionId!;

              if (!parent.publishedAt) {
                return error("Cannot move document inside a draft");
              }
            } else if (!collectionId) {
              return error(
                "Either collectionId or parentDocumentId is required"
              );
            } else {
              const collection = await Collection.findByPk(collectionId, {
                userId: user.id,
                rejectOnEmpty: true,
                transaction,
              });
              authorize(user, "updateDocument", collection);
            }

            const { documents, collections } = await documentMover(ctx, {
              document,
              collectionId: collectionId ?? null,
              parentDocumentId: input.parentDocumentId ?? null,
              index: input.index,
            });

            const indexMap = new Map<string, number>();
            for (const col of collections) {
              if (col.documentStructure) {
                for (const [id, idx] of buildSiblingIndexMap(
                  col.documentStructure
                )) {
                  indexMap.set(id, idx);
                }
              }
            }

            const presented = await Promise.all(
              documents.map(async (doc) => {
                const result = pathToUrl(
                  user.team,
                  await presentDocument(undefined, doc, {
                    includeData: false,
                    includeText: false,
                  })
                );
                const siblingIndex = indexMap.get(doc.id);
                if (siblingIndex !== undefined) {
                  result.index = siblingIndex;
                }
                return result;
              })
            );
            return success(presented);
          });
        } catch (message) {
          return error(message);
        }
      })
    );
  }

  if (AuthenticationHelper.canAccess("documents.update", scopes)) {
    server.registerTool(
      "update_document",
      {
        title: "Update document",
        description:
          'Updates an existing document by its ID. Only the fields provided will be updated.\n\n⚠️ STYLING LOSS WARNING: Markdown cannot represent many rich attributes. Passing `text` in the default "replace" mode (or omitting editMode) performs a full markdown round-trip that WILL DISCARD: table cell background colors, table column widths, table full-width layout, image dimensions, highlight/comment marks, and other node-level attributes not expressible in markdown. The document structure is rebuilt from the markdown, so any styling the caller did not re-encode is gone.\n\nSafe paths to preserve styling:\n  • Metadata only (title, icon, color, fullWidth, publish) — omit `text`/`data`/`patches`; content untouched.\n  • Surgical content edits — use editMode "patch" with findText+text, or `patches` / multi_patch_document. Only matched ranges change; rest preserved byte-for-byte.\n  • Full replacement that must preserve attrs — use `data` (ProseMirror JSON from get_document_data), NOT `text`. Optionally pair with `disableSmartTypography: true`.\n  • Per-attribute edits on tables — use the dedicated MCP tools (set_table_cell_background, set_table_column_width, set_table_layout, merge_table_cells, split_table_cell) or update_document_block for single-block surgery.\n\nFor batched edits, prefer multi_patch_document over repeated calls.',
        annotations: {
          idempotentHint: true,
          readOnlyHint: false,
        },
        inputSchema: {
          id: z
            .string()
            .describe("The unique identifier of the document to update."),
          title: z
            .string()
            .optional()
            .describe("The new title for the document."),
          text: z
            .string()
            .optional()
            .describe(
              'The markdown content to apply. In "replace" mode this becomes the entire document. In "append"/"prepend" mode it is added to the end/beginning. In "patch" mode this is the replacement text for the matched findText. Mutually exclusive with `data` and `patches`. ⚠️ In "replace" mode the markdown round-trip DISCARDS styling that markdown cannot express (table cell colors, column widths, table full-width layout, image dimensions, highlight/comment marks). Use `data`, `patches`, or editMode "patch" to preserve them.'
            ),
          data: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "A full ProseMirror JSON document to replace the document content. Use this for lossless round-trips of node-level attributes that markdown cannot express. Mutually exclusive with `text` and `patches`."
            ),
          disableSmartTypography: z
            .boolean()
            .optional()
            .describe(
              "When true, smart (curly) quotes are NOT normalized to straight quotes during patch lookup. Pass this when the caller's findText contains the original curly-quote characters and must match them verbatim."
            ),
          patches: z
            .array(patchSchema)
            .max(50)
            .optional()
            .describe(
              "Multiple find/replace patches applied atomically in a single transaction. Prefer multi_patch_document for this use case. Mutually exclusive with `text` and `data`."
            ),
          editMode: z
            .enum(TextEditMode)
            .optional()
            .describe(
              'How to apply the text update. "replace" (default) replaces the entire document content. "append" adds text to the end. "prepend" adds text to the beginning. "patch" finds the exact markdown specified in findText and replaces only that portion, preserving the rest of the document including any rich formatting that cannot be represented in markdown.'
            ),
          findText: z
            .string()
            .optional()
            .describe(
              'Required when editMode is "patch". The exact markdown substring to find in the document. This should be copied verbatim from the document\'s existing markdown content. The first occurrence will be replaced with the text parameter. Can span multiple blocks (paragraphs, headings, etc).'
            ),
          collectionId: z
            .string()
            .optional()
            .describe(
              "The collection ID to publish a draft to, required when publishing a draft that has no collection."
            ),
          icon: z
            .string()
            .nullable()
            .optional()
            .describe(
              "An icon for the document, e.g. an emoji. Set to null to remove."
            ),
          color: z
            .string()
            .nullable()
            .optional()
            .describe(
              "The hex color for the document icon. Set to null to remove."
            ),
          publish: z
            .boolean()
            .optional()
            .describe(
              "Set to true to publish a draft document, or false to convert a published document back to a draft."
            ),
          fullWidth: z
            .boolean()
            .optional()
            .describe(
              "Whether the document should render in full-width mode (stretching all tables and content across the available width)."
            ),
        },
      },
      withTracing("update_document", async (input, context) => {
        try {
          const ctx = buildAPIContext(context);
          const { user } = ctx.state.auth;

          const document = await Document.findByPk(input.id, {
            userId: user.id,
            includeState: true,
            rejectOnEmpty: true,
          });

          let updated;

          if (input.publish === false) {
            authorize(user, "unpublish", document);

            updated = await document.unpublishWithCtx(ctx, {
              detach: false,
            });
          } else {
            authorize(user, "update", document);

            updated = await documentUpdater(ctx, {
              document,
              ...input,
            });
          }

          const { text, ...attributes } = await presentDocument(
            undefined,
            updated,
            {
              includeData: false,
              includeText: true,
              includeUpdatedAt: true,
            }
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(pathToUrl(user.team, attributes)),
              },
              {
                type: "text" as const,
                text: String(text ?? ""),
              },
            ],
          } satisfies CallToolResult;
        } catch (message) {
          return error(message);
        }
      })
    );
  }

  if (AuthenticationHelper.canAccess("documents.info", scopes)) {
    server.registerTool(
      "get_document_data",
      {
        title: "Get document ProseMirror JSON",
        description:
          "Returns the document content as ProseMirror JSON. Use when you need to see or round-trip node-level attributes (table cell colors, column widths, image dimensions) that markdown cannot express.",
        annotations: {
          idempotentHint: true,
          readOnlyHint: true,
        },
        inputSchema: {
          documentId: z
            .string()
            .describe("The unique identifier of the document to inspect."),
        },
      },
      withTracing("get_document_data", async ({ documentId }, extra) => {
        try {
          const user = getActorFromContext(extra);

          const document = await Document.findByPk(documentId, {
            userId: user.id,
            rejectOnEmpty: true,
          });
          authorize(user, "read", document);

          const data = await DocumentHelper.toJSON(document, {
            teamId: user.teamId,
          });
          return success({ data });
        } catch (message) {
          return error(message);
        }
      })
    );

    server.registerTool(
      "list_document_blocks",
      {
        title: "List top-level document blocks",
        description:
          "Returns every top-level block with a positional index and a content hash. Use this to plan surgical edits when you want to touch one block without re-sending the whole document. The returned contentHash can be passed to update_document_block for optimistic concurrency.",
        annotations: {
          idempotentHint: true,
          readOnlyHint: true,
        },
        inputSchema: {
          documentId: z
            .string()
            .describe("The unique identifier of the document to inspect."),
        },
      },
      withTracing("list_document_blocks", async ({ documentId }, extra) => {
        try {
          const user = getActorFromContext(extra);

          const document = await Document.findByPk(documentId, {
            userId: user.id,
            rejectOnEmpty: true,
          });
          authorize(user, "read", document);

          const blocks = DocumentHelper.getBlocks(document);
          return success({ blocks });
        } catch (message) {
          return error(message);
        }
      })
    );
  }

  if (AuthenticationHelper.canAccess("documents.update", scopes)) {
    server.registerTool(
      "update_document_block",
      {
        title: "Update a single document block",
        description:
          "Replace a single top-level block by its index. Provide either `data` (ProseMirror JSON) or `text` (markdown that resolves to exactly one block node), but not both. Pass `contentHash` (from list_document_blocks) for optimistic concurrency — the update is rejected if the block has changed since you listed it.",
        annotations: {
          idempotentHint: false,
          readOnlyHint: false,
        },
        inputSchema: {
          documentId: z
            .string()
            .describe("The unique identifier of the document to update."),
          blockIndex: z
            .number()
            .int()
            .min(0)
            .describe(
              "Zero-based index of the top-level block to replace, as returned by list_document_blocks."
            ),
          contentHash: z
            .string()
            .optional()
            .describe(
              "Optional 8-char content hash from list_document_blocks. If provided and the block has since changed, the update is rejected."
            ),
          data: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "ProseMirror JSON for the replacement block. Mutually exclusive with `text`."
            ),
          text: z
            .string()
            .optional()
            .describe(
              "Markdown for the replacement block; must resolve to exactly one top-level block node. Mutually exclusive with `data`."
            ),
        },
      },
      withTracing("update_document_block", async (input, context) => {
        try {
          const ctx = buildAPIContext(context);
          const { user } = ctx.state.auth;

          return await sequelize.transaction(async (transaction) => {
            const document = await Document.findByPk(input.documentId, {
              userId: user.id,
              includeState: true,
              rejectOnEmpty: true,
              transaction,
            });
            authorize(user, "update", document);

            DocumentHelper.updateBlock(document, input.blockIndex, {
              data: input.data,
              text: input.text,
              contentHash: input.contentHash,
            });
            await document.save({ transaction });

            return success(
              pathToUrl(
                user.team,
                await presentDocument(undefined, document, {
                  includeData: false,
                  includeText: false,
                  includeUpdatedAt: true,
                })
              )
            );
          });
        } catch (message) {
          return error(message);
        }
      })
    );

    server.registerTool(
      "multi_patch_document",
      {
        title: "Apply multiple patches atomically",
        description:
          "Apply multiple find/replace patches atomically in a single transaction. All patches must match; any miss aborts the whole operation. Prefer this over calling update_document repeatedly for batched agent edits. Each findText matches its first occurrence in the document's normalized markdown; to target a later occurrence, include more surrounding context.",
        annotations: {
          idempotentHint: false,
          readOnlyHint: false,
        },
        inputSchema: {
          documentId: z
            .string()
            .describe("The unique identifier of the document to patch."),
          patches: z
            .array(patchSchema)
            .min(1)
            .max(50)
            .describe(
              "An array of up to 50 find/replace patches to apply atomically."
            ),
        },
      },
      withTracing("multi_patch_document", async (input, context) => {
        try {
          const ctx = buildAPIContext(context);
          const { user } = ctx.state.auth;

          return await sequelize.transaction(async (transaction) => {
            const document = await Document.findByPk(input.documentId, {
              userId: user.id,
              includeState: true,
              rejectOnEmpty: true,
              transaction,
            });
            authorize(user, "update", document);

            DocumentHelper.applyMultiPatch(document, input.patches);
            await document.save({ transaction });

            return success(
              pathToUrl(
                user.team,
                await presentDocument(undefined, document, {
                  includeData: false,
                  includeText: false,
                  includeUpdatedAt: true,
                })
              )
            );
          });
        } catch (message) {
          return error(message);
        }
      })
    );
  }
}
