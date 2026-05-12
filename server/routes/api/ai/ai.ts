import Router from "koa-router";
import env from "@server/env";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import timeout from "@server/middlewares/timeout";
import validate from "@server/middlewares/validate";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { createAIFormattingProvider } from "@server/services/ai";
import * as T from "./schema";

const router = new Router();

router.post(
  "ai.format",
  rateLimiter(RateLimiterStrategy.FivePerMinute),
  timeout(env.AI_FORMATTING_TIMEOUT + 5000),
  auth(),
  validate(T.AIFormatSchema),
  async (ctx: APIContext<T.AIFormatReq>) => {
    const provider = createAIFormattingProvider();
    const text = await provider.formatText(ctx.input.body);

    ctx.body = {
      data: { text },
    };
  }
);

export default router;
