import { Environment } from "./env";
import presentEnv from "./presenters/env";

describe("VIEWPORT_GATED_EMBEDS_ENABLED", () => {
  const originalValue = process.env.VIEWPORT_GATED_EMBEDS_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.VIEWPORT_GATED_EMBEDS_ENABLED;
      return;
    }
    process.env.VIEWPORT_GATED_EMBEDS_ENABLED = originalValue;
  });

  it.each([
    [undefined, false],
    ["true", true],
    ["false", false],
  ] as const)("parses %s as %s", (value, expected) => {
    if (value === undefined) {
      delete process.env.VIEWPORT_GATED_EMBEDS_ENABLED;
    } else {
      process.env.VIEWPORT_GATED_EMBEDS_ENABLED = value;
    }

    expect(new Environment().VIEWPORT_GATED_EMBEDS_ENABLED).toBe(expected);
  });

  it("presents the value as a public boolean", () => {
    process.env.VIEWPORT_GATED_EMBEDS_ENABLED = "true";
    const presented = presentEnv(new Environment());

    expect(presented.VIEWPORT_GATED_EMBEDS_ENABLED).toBe(true);
  });
});
