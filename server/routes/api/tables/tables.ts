import Router from "koa-router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Document } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { authorize } from "@server/policies";
import { presentDocument, presentPolicies } from "@server/presenters";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();

router.post(
  "tables.setCellBackground",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.TablesSetCellBackgroundSchema),
  transaction(),
  async (ctx: APIContext<T.TablesSetCellBackgroundReq>) => {
    const { transaction: tx } = ctx.state;
    const { id, tableIndex, row, col, color } = ctx.input.body;
    const { user } = ctx.state.auth;

    let document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
      transaction: tx,
    });
    authorize(user, "update", document);

    document = DocumentHelper.applyTableSetCellBackground(
      document,
      tableIndex,
      row,
      col,
      color
    );
    await document.save({ transaction: tx });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "tables.setColumnWidth",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.TablesSetColumnWidthSchema),
  transaction(),
  async (ctx: APIContext<T.TablesSetColumnWidthReq>) => {
    const { transaction: tx } = ctx.state;
    const { id, tableIndex, col, width } = ctx.input.body;
    const { user } = ctx.state.auth;

    let document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
      transaction: tx,
    });
    authorize(user, "update", document);

    document = DocumentHelper.applyTableSetColumnWidth(
      document,
      tableIndex,
      col,
      width
    );
    await document.save({ transaction: tx });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "tables.mergeCells",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.TablesMergeCellsSchema),
  transaction(),
  async (ctx: APIContext<T.TablesMergeCellsReq>) => {
    const { transaction: tx } = ctx.state;
    const { id, tableIndex, fromRow, fromCol, toRow, toCol } = ctx.input.body;
    const { user } = ctx.state.auth;

    let document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
      transaction: tx,
    });
    authorize(user, "update", document);

    document = DocumentHelper.applyTableMergeCells(
      document,
      tableIndex,
      fromRow,
      fromCol,
      toRow,
      toCol
    );
    await document.save({ transaction: tx });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "tables.splitCell",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.TablesSplitCellSchema),
  transaction(),
  async (ctx: APIContext<T.TablesSplitCellReq>) => {
    const { transaction: tx } = ctx.state;
    const { id, tableIndex, row, col } = ctx.input.body;
    const { user } = ctx.state.auth;

    let document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
      transaction: tx,
    });
    authorize(user, "update", document);

    document = DocumentHelper.applyTableSplitCell(
      document,
      tableIndex,
      row,
      col
    );
    await document.save({ transaction: tx });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

export default router;
