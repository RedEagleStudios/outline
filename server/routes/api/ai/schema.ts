import { z } from "zod";
import env from "@server/env";
import { BaseSchema } from "@server/routes/api/schema";

export const AIFormatSchema = BaseSchema.extend({
  body: z.object({
    text: z.string().trim().min(1).max(env.AI_FORMATTING_MAX_INPUT_CHARS),
    prompt: z.string().trim().min(1).max(env.AI_FORMATTING_MAX_PROMPT_CHARS),
  }),
});

export type AIFormatReq = z.infer<typeof AIFormatSchema>;
