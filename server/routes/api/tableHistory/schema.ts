import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";

const HistoryIdSchema = z.string().min(1).max(128);
const HistoryTextSchema = z.string().max(20_000).nullable().optional();
const HistoryHashSchema = z.string().max(128).nullable().optional();

export const TableHistoryListSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.uuid(),
    tableId: z.string().min(1),
    cellId: z.string().min(1).optional(),
    rowId: z.string().min(1).optional(),
    columnId: z.string().min(1).optional(),
    actorId: z.uuid().optional(),
  }),
});

export type TableHistoryListReq = z.infer<typeof TableHistoryListSchema>;

export const TableHistoryCaptureSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.uuid(),
    tableId: HistoryIdSchema,
    cellId: HistoryIdSchema,
    rowId: HistoryIdSchema.nullable().optional(),
    oldText: HistoryTextSchema,
    newText: HistoryTextSchema,
    oldValueHash: HistoryHashSchema,
    newValueHash: HistoryHashSchema,
    clientMutationId: z.string().min(1).max(128).optional(),
  }),
});

export type TableHistoryCaptureReq = z.infer<typeof TableHistoryCaptureSchema>;

export const TableHistoryInfoSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type TableHistoryInfoReq = z.infer<typeof TableHistoryInfoSchema>;
