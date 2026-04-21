import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { zodIdType } from "@server/utils/zod";
import { ValidateColor } from "@server/validation";

const BaseTableSchema = z.object({
  /** Id of the document containing the target table. */
  id: zodIdType(),
  /** Zero-based index of the table within the document's top-level nodes. */
  tableIndex: z.number().int().min(0),
});

export const TablesSetCellBackgroundSchema = BaseSchema.extend({
  body: BaseTableSchema.extend({
    /** Zero-based row index of the target cell. */
    row: z.number().int().min(0),
    /** Zero-based column index of the target cell. */
    col: z.number().int().min(0),
    /** Hex color to set as the cell background. Null clears the background. */
    color: z
      .string()
      .regex(ValidateColor.regex, { message: ValidateColor.message })
      .nullable(),
  }),
});

export type TablesSetCellBackgroundReq = z.infer<
  typeof TablesSetCellBackgroundSchema
>;

export const TablesSetColumnWidthSchema = BaseSchema.extend({
  body: BaseTableSchema.extend({
    /** Zero-based column index to resize. */
    col: z.number().int().min(0),
    /** New width in pixels. Must be positive. */
    width: z.number().positive(),
  }),
});

export type TablesSetColumnWidthReq = z.infer<
  typeof TablesSetColumnWidthSchema
>;

export const TablesMergeCellsSchema = BaseSchema.extend({
  body: BaseTableSchema.extend({
    /** Top-left cell row index of the rectangle to merge (inclusive). */
    fromRow: z.number().int().min(0),
    /** Top-left cell column index of the rectangle to merge (inclusive). */
    fromCol: z.number().int().min(0),
    /** Bottom-right cell row index of the rectangle to merge (inclusive). */
    toRow: z.number().int().min(0),
    /** Bottom-right cell column index of the rectangle to merge (inclusive). */
    toCol: z.number().int().min(0),
  }),
});

export type TablesMergeCellsReq = z.infer<typeof TablesMergeCellsSchema>;

export const TablesSplitCellSchema = BaseSchema.extend({
  body: BaseTableSchema.extend({
    /** Zero-based row index of the merged cell to split. */
    row: z.number().int().min(0),
    /** Zero-based column index of the merged cell to split. */
    col: z.number().int().min(0),
  }),
});

export type TablesSplitCellReq = z.infer<typeof TablesSplitCellSchema>;

export const TablesSetLayoutSchema = BaseSchema.extend({
  body: BaseTableSchema.extend({
    /**
     * Layout to apply: "full-width" stretches the table across the document
     * width; null reverts to the default content-sized layout.
     */
    layout: z.enum(["full-width"]).nullable(),
  }),
});

export type TablesSetLayoutReq = z.infer<typeof TablesSetLayoutSchema>;
