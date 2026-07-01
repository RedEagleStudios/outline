import crypto from "node:crypto";
import Router from "koa-router";
import { v4 as uuidv4 } from "uuid";
import { loadPublicShare } from "@server/commands/shareLoader";
import { AuthenticationError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Document, ExcalidrawDrawingRevision } from "@server/models";
import { authorize } from "@server/policies";
import { presentExcalidrawDrawingRevision } from "@server/presenters";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { getTeamFromContext } from "@server/utils/passport";
import * as T from "./schema";

const router = new Router();

router.post(
  "excalidraw.info",
  auth({ optional: true }),
  validate(T.ExcalidrawInfoSchema),
  async (ctx: APIContext<T.ExcalidrawInfoReq>) => {
    const { id, shareId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const revision = await ExcalidrawDrawingRevision.findByPk(id, {
      rejectOnEmpty: true,
    });

    if (shareId) {
      const teamFromCtx = await getTeamFromContext(ctx, {
        includeStateCookie: false,
      });
      const result = await loadPublicShare({
        id: shareId,
        documentId: revision.documentId,
        teamId: teamFromCtx?.id,
      });

      if (!result.document || result.document.id !== revision.documentId) {
        throw ValidationError("Drawing revision is not available for this share");
      }
    } else {
      if (!user) {
        throw AuthenticationError("Authentication required");
      }

      const document = await Document.findByPk(revision.documentId, {
        userId: user.id,
      });
      authorize(user, "read", document);
    }

    ctx.body = { data: presentExcalidrawDrawingRevision(revision) };
  }
);

router.post(
  "excalidraw.create",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.ExcalidrawCreateSchema),
  transaction(),
  async (ctx: APIContext<T.ExcalidrawCreateReq>) => {
    const { documentId, scene, preview, baseDrawingRevisionId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const files = scene.files ?? {};

    if (Object.keys(files).length > 0) {
      throw ValidationError("Embedded Excalidraw files are not supported yet");
    }

    const document = await Document.findByPk(documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "update", document);

    const drawingId = ctx.input.body.drawingId ?? uuidv4();
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:lockKey));", {
      replacements: { lockKey: `${documentId}:${drawingId}` },
      transaction,
    });

    const latest = await ExcalidrawDrawingRevision.findOne({
      where: { documentId, drawingId },
      order: [["createdAt", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (latest && latest.id !== baseDrawingRevisionId) {
      throw ValidationError("The drawing has been updated since it was opened");
    }

    const checksum = crypto
      .createHash("sha256")
      .update(JSON.stringify(scene))
      .digest("hex");
    const revision = await ExcalidrawDrawingRevision.create(
      {
        drawingId,
        documentId,
        teamId: document.teamId,
        createdById: user.id,
        scene,
        preview: preview ?? null,
        checksum,
      },
      { transaction }
    );

    ctx.body = { data: presentExcalidrawDrawingRevision(revision) };
  }
);

export default router;
