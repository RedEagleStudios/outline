import env from "@server/env";
import { InvalidRequestError } from "@server/errors";
import type { AIFormattingProvider } from "./AIFormattingProvider";
import { OpenCodeFormattingProvider } from "./OpenCodeFormattingProvider";

/**
 * Creates the configured AI formatting provider.
 *
 * @returns the configured AI formatting provider.
 * @throws if AI formatting is disabled or the provider is unsupported.
 */
export function createAIFormattingProvider(): AIFormattingProvider {
  if (!env.AI_FORMATTING_ENABLED) {
    throw InvalidRequestError("AI formatting is disabled");
  }

  if (env.AI_FORMATTING_PROVIDER === "opencode") {
    return new OpenCodeFormattingProvider();
  }

  throw InvalidRequestError("AI formatting provider is not configured");
}
