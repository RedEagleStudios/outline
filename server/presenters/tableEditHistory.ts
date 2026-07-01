import type { TableEditHistoryBatch, TableEditHistoryOp } from "@server/models";
import presentUser from "./user";

/**
 * Presents a table edit history batch for API responses.
 *
 * @param batch the batch to present.
 * @returns the serialized batch.
 */
export function presentTableEditHistoryBatch(batch: TableEditHistoryBatch) {
  return {
    id: batch.id,
    documentId: batch.documentId,
    tableId: batch.tableId,
    actorId: batch.actorId,
    actor: batch.actor ? presentUser(batch.actor) : null,
    source: batch.source,
    operationSummary: batch.operationSummary,
    opCount: batch.opCount,
    occurredAt: batch.occurredAt,
    endedAt: batch.endedAt,
    metadata: batch.metadata,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

/**
 * Presents a table edit history operation for API responses.
 *
 * @param op the operation to present.
 * @returns the serialized operation.
 */
export function presentTableEditHistoryOp(op: TableEditHistoryOp) {
  return {
    id: op.id,
    batchId: op.batchId,
    documentId: op.documentId,
    tableId: op.tableId,
    actorId: op.actorId,
    actor: op.actor ? presentUser(op.actor) : null,
    source: op.source,
    operation: op.operation,
    occurredAt: op.occurredAt,
    rowId: op.rowId,
    columnId: op.columnId,
    cellId: op.cellId,
    rowIndexBefore: op.rowIndexBefore,
    rowIndexAfter: op.rowIndexAfter,
    columnIndexBefore: op.columnIndexBefore,
    columnIndexAfter: op.columnIndexAfter,
    oldText: op.oldText,
    newText: op.newText,
    oldValueHash: op.oldValueHash,
    newValueHash: op.newValueHash,
    oldAttrs: op.oldAttrs,
    newAttrs: op.newAttrs,
    metadata: op.metadata,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
  };
}
