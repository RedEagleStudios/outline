import Router from "koa-router";
import env from "@server/env";
import { NotFoundError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Document,
  TableEditHistoryBatch,
  TableEditHistoryOp,
  User,
} from "@server/models";
import { authorize } from "@server/policies";
import {
  presentTableEditHistoryBatch,
  presentTableEditHistoryOp,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import pagination, { paginateQuery } from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

router.post(
  "tableHistory.capture",
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  auth(),
  validate(T.TableHistoryCaptureSchema),
  transaction(),
  async (ctx: APIContext<T.TableHistoryCaptureReq>) => {
    if (!env.TABLE_EDIT_HISTORY_ENABLED) {
      ctx.body = {
        success: true,
      };
      return;
    }

    const { user } = ctx.state.auth;
    const { transaction: tx } = ctx.state;
    const {
      documentId,
      tableId,
      cellId,
      rowId,
      oldText,
      newText,
      oldValueHash,
      newValueHash,
      clientMutationId,
    } = ctx.input.body;

    if ((oldText ?? "") === (newText ?? "")) {
      throw ValidationError("History capture must include a text change");
    }

    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
      transaction: tx,
    });
    authorize(user, "update", document);

    const now = new Date();
    const batch = await TableEditHistoryBatch.create(
      {
        teamId: document.teamId,
        documentId: document.id,
        tableId,
        actorId: user.id,
        source: "client_unverified",
        operationSummary: "cell_update",
        opCount: 1,
        occurredAt: now,
        endedAt: now,
        metadata: clientMutationId ? { clientMutationId } : null,
      },
      { transaction: tx }
    );

    const op = await TableEditHistoryOp.create(
      {
        batchId: batch.id,
        teamId: document.teamId,
        documentId: document.id,
        tableId,
        actorId: user.id,
        source: "client_unverified",
        operation: "cell_update",
        occurredAt: now,
        rowId: rowId ?? null,
        columnId: null,
        cellId,
        rowIndexBefore: null,
        rowIndexAfter: null,
        columnIndexBefore: null,
        columnIndexAfter: null,
        oldText: oldText ?? null,
        newText: newText ?? null,
        oldValueHash: oldValueHash ?? null,
        newValueHash: newValueHash ?? null,
        oldAttrs: null,
        newAttrs: null,
        metadata: clientMutationId ? { clientMutationId } : null,
      },
      { transaction: tx }
    );

    ctx.body = {
      data: presentTableEditHistoryOp(op),
    };
  }
);

router.post(
  "tableHistory.list",
  auth(),
  validate(T.TableHistoryListSchema),
  pagination(),
  async (ctx: APIContext<T.TableHistoryListReq>) => {
    if (!env.TABLE_EDIT_HISTORY_ENABLED) {
      ctx.body = {
        pagination: ctx.state.pagination,
        data: {
          batches: [],
          ops: [],
        },
      };
      return;
    }

    const { user } = ctx.state.auth;
    const { documentId, tableId, cellId, rowId, columnId, actorId } =
      ctx.input.body;

    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "listRevisions", document);

    const opWhere = {
      documentId,
      tableId,
      ...(cellId ? { cellId } : {}),
      ...(rowId ? { rowId } : {}),
      ...(columnId ? { columnId } : {}),
      ...(actorId ? { actorId } : {}),
    };
    const batchWhere = {
      documentId,
      tableId,
      ...(actorId ? { actorId } : {}),
    };

    if (cellId || rowId || columnId) {
      const { results, pagination: paginationState } = await paginateQuery(
        ctx,
        ({ offset, limit }) =>
          TableEditHistoryOp.findAll({
            where: opWhere,
            include: [
              {
                model: User,
                as: "actor",
              },
            ],
            order: [
              ["occurredAt", "DESC"],
              ["id", "DESC"],
            ],
            offset,
            limit,
          }),
        () => TableEditHistoryOp.count({ where: opWhere })
      );

      ctx.body = {
        pagination: paginationState,
        data: {
          batches: [],
          ops: results.map(presentTableEditHistoryOp),
        },
      };
      return;
    }

    const { results, pagination: paginationState } = await paginateQuery(
      ctx,
      ({ offset, limit }) =>
        TableEditHistoryBatch.findAll({
          where: batchWhere,
          include: [
            {
              model: User,
              as: "actor",
            },
          ],
          order: [
            ["endedAt", "DESC"],
            ["id", "DESC"],
          ],
          offset,
          limit,
        }),
      () => TableEditHistoryBatch.count({ where: batchWhere })
    );
    ctx.body = {
      pagination: paginationState,
      data: {
        batches: results.map(presentTableEditHistoryBatch),
        ops: [],
      },
    };
  }
);

router.post(
  "tableHistory.info",
  auth(),
  validate(T.TableHistoryInfoSchema),
  async (ctx: APIContext<T.TableHistoryInfoReq>) => {
    if (!env.TABLE_EDIT_HISTORY_ENABLED) {
      throw NotFoundError("Table edit history not found");
    }

    const { user } = ctx.state.auth;
    const { id } = ctx.input.body;
    const op = await TableEditHistoryOp.findByPk(id, {
      include: [
        {
          model: User,
          as: "actor",
        },
      ],
      rejectOnEmpty: true,
    });
    const document = await Document.findByPk(op.documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "listRevisions", document);

    ctx.body = {
      data: presentTableEditHistoryOp(op),
    };
  }
);

export default router;
