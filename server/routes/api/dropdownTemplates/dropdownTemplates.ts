import Router from "koa-router";
import type { WhereOptions } from "sequelize";
import { Op } from "sequelize";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { authorize } from "@server/policies";
import { DropdownTemplate } from "@server/models";
import { presentDropdownTemplate, presentPolicies } from "@server/presenters";
import type { APIContext } from "@server/types";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

router.post(
  "dropdownTemplates.list",
  auth(),
  pagination(),
  validate(T.DropdownTemplatesListSchema),
  async (ctx: APIContext<T.DropdownTemplatesListReq>) => {
    const { query } = ctx.input.body;
    const { user } = ctx.state.auth;

    authorize(user, "readDropdownTemplate", user.team);

    const where: WhereOptions<DropdownTemplate> = {
      teamId: user.teamId,
      ...(query
        ? {
            name: {
              [Op.iLike]: `%${query}%`,
            },
          }
        : undefined),
    };

    const [dropdownTemplates, total] = await Promise.all([
      DropdownTemplate.findAll({
        where,
        order: [["name", "ASC"]],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
      DropdownTemplate.count({ where }),
    ]);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: dropdownTemplates.map(presentDropdownTemplate),
      policies: presentPolicies(user, dropdownTemplates),
    };
  }
);

router.post(
  "dropdownTemplates.create",
  auth(),
  validate(T.DropdownTemplatesCreateSchema),
  transaction(),
  async (ctx: APIContext<T.DropdownTemplatesCreateReq>) => {
    const { name, options } = ctx.input.body;
    const { user } = ctx.state.auth;

    authorize(user, "createDropdownTemplate", user.team);

    const dropdownTemplate = await DropdownTemplate.createWithCtx(ctx, {
      name,
      options,
      teamId: user.teamId,
      createdById: user.id,
      updatedById: user.id,
    });

    ctx.body = {
      data: presentDropdownTemplate(dropdownTemplate),
      policies: presentPolicies(user, [dropdownTemplate]),
    };
  }
);

router.post(
  "dropdownTemplates.update",
  auth(),
  validate(T.DropdownTemplatesUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.DropdownTemplatesUpdateReq>) => {
    const { id, name, options } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const dropdownTemplate = await DropdownTemplate.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    authorize(user, "update", dropdownTemplate);

    await dropdownTemplate.updateWithCtx(ctx, {
      name,
      options,
      updatedById: user.id,
    });

    ctx.body = {
      data: presentDropdownTemplate(dropdownTemplate),
      policies: presentPolicies(user, [dropdownTemplate]),
    };
  }
);

router.post(
  "dropdownTemplates.delete",
  auth(),
  validate(T.DropdownTemplatesDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.DropdownTemplatesDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const dropdownTemplate = await DropdownTemplate.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    authorize(user, "delete", dropdownTemplate);
    await dropdownTemplate.destroyWithCtx(ctx);

    ctx.body = {
      success: true,
    };
  }
);

export default router;
