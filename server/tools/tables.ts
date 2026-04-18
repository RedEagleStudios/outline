import { z } from "zod";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { authorize } from "@server/policies";
import { presentDocument } from "@server/presenters";
import { sequelize } from "@server/storage/database";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import {
  buildAPIContext,
  error,
  pathToUrl,
  success,
  withTracing,
} from "./util";

/**
 * Registers table-related MCP tools on the given server, filtered by
 * the OAuth scopes granted to the current token. All table mutations
 * gate on the `documents.update` scope because they edit document content.
 *
 * @param server - the MCP server instance to register on.
 * @param scopes - the OAuth scopes granted to the access token.
 */
export function tableTools(server: McpServer, scopes: string[]) {
  if (!AuthenticationHelper.canAccess("documents.update", scopes)) {
    return;
  }

  server.registerTool(
    "set_table_cell_background",
    {
      title: "Set table cell background color",
      description:
        "Sets or clears the background color of a single table cell. Use a hex color (e.g. #FFDDEE) to set or null to clear. The table is identified by its zero-based index among top-level tables in the document; cells are identified by (row, col).",
      annotations: {
        idempotentHint: true,
        readOnlyHint: false,
      },
      inputSchema: {
        documentId: z
          .string()
          .describe("The unique identifier of the document to update."),
        tableIndex: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based index of the target table."),
        row: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based row index of the target cell."),
        col: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based column index of the target cell."),
        color: z
          .string()
          .nullable()
          .describe(
            "Hex color to set (e.g. #FFDDEE) or null to clear the background."
          ),
      },
    },
    withTracing("set_table_cell_background", async (input, context) => {
      try {
        const ctx = buildAPIContext(context);
        const { user } = ctx.state.auth;

        return await sequelize.transaction(async (transaction) => {
          let document = await Document.findByPk(input.documentId, {
            userId: user.id,
            includeState: true,
            rejectOnEmpty: true,
            transaction,
          });
          authorize(user, "update", document);

          document = DocumentHelper.applyTableSetCellBackground(
            document,
            input.tableIndex,
            input.row,
            input.col,
            input.color
          );
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
    "set_table_column_width",
    {
      title: "Set table column width",
      description:
        "Sets the pixel width of a single column in a table. Width must be a positive number of pixels (capped at 10000 to match the schema limit).",
      annotations: {
        idempotentHint: true,
        readOnlyHint: false,
      },
      inputSchema: {
        documentId: z
          .string()
          .describe("The unique identifier of the document to update."),
        tableIndex: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based index of the target table."),
        col: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based column index to resize."),
        width: z
          .number()
          .positive()
          .max(10000)
          .describe("New width in pixels. Must be positive; max 10000."),
      },
    },
    withTracing("set_table_column_width", async (input, context) => {
      try {
        const ctx = buildAPIContext(context);
        const { user } = ctx.state.auth;

        return await sequelize.transaction(async (transaction) => {
          let document = await Document.findByPk(input.documentId, {
            userId: user.id,
            includeState: true,
            rejectOnEmpty: true,
            transaction,
          });
          authorize(user, "update", document);

          document = DocumentHelper.applyTableSetColumnWidth(
            document,
            input.tableIndex,
            input.col,
            input.width
          );
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
    "merge_table_cells",
    {
      title: "Merge table cells",
      description:
        "Merges a rectangular range of cells in a table into a single cell. The rectangle is defined by (fromRow, fromCol) to (toRow, toCol), all inclusive and zero-based.",
      annotations: {
        idempotentHint: false,
        readOnlyHint: false,
      },
      inputSchema: {
        documentId: z
          .string()
          .describe("The unique identifier of the document to update."),
        tableIndex: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based index of the target table."),
        fromRow: z
          .number()
          .int()
          .min(0)
          .describe("Top row of the merge rectangle (inclusive)."),
        fromCol: z
          .number()
          .int()
          .min(0)
          .describe("Left column of the merge rectangle (inclusive)."),
        toRow: z
          .number()
          .int()
          .min(0)
          .describe("Bottom row of the merge rectangle (inclusive)."),
        toCol: z
          .number()
          .int()
          .min(0)
          .describe("Right column of the merge rectangle (inclusive)."),
      },
    },
    withTracing("merge_table_cells", async (input, context) => {
      try {
        const ctx = buildAPIContext(context);
        const { user } = ctx.state.auth;

        return await sequelize.transaction(async (transaction) => {
          let document = await Document.findByPk(input.documentId, {
            userId: user.id,
            includeState: true,
            rejectOnEmpty: true,
            transaction,
          });
          authorize(user, "update", document);

          document = DocumentHelper.applyTableMergeCells(
            document,
            input.tableIndex,
            input.fromRow,
            input.fromCol,
            input.toRow,
            input.toCol
          );
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
    "split_table_cell",
    {
      title: "Split a merged table cell",
      description:
        "Splits a previously-merged cell in a table back into its constituent single cells. The cell is identified by its (row, col) coordinates within the target table.",
      annotations: {
        idempotentHint: false,
        readOnlyHint: false,
      },
      inputSchema: {
        documentId: z
          .string()
          .describe("The unique identifier of the document to update."),
        tableIndex: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based index of the target table."),
        row: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based row index of the merged cell to split."),
        col: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based column index of the merged cell to split."),
      },
    },
    withTracing("split_table_cell", async (input, context) => {
      try {
        const ctx = buildAPIContext(context);
        const { user } = ctx.state.auth;

        return await sequelize.transaction(async (transaction) => {
          let document = await Document.findByPk(input.documentId, {
            userId: user.id,
            includeState: true,
            rejectOnEmpty: true,
            transaction,
          });
          authorize(user, "update", document);

          document = DocumentHelper.applyTableSplitCell(
            document,
            input.tableIndex,
            input.row,
            input.col
          );
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
