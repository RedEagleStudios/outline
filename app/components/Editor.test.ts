import { shouldEnableViewportGatedEmbeds } from "./EditorPolicy";

describe("shouldEnableViewportGatedEmbeds", () => {
  it.each([
    [undefined, true, undefined, false],
    [false, false, undefined, false],
    [true, false, undefined, false],
    [true, true, undefined, true],
    [true, true, "share-id", false],
  ] as const)(
    "with eligibility=%s, global=%s, and share=%s returns %s",
    (eligible, globallyEnabled, shareId, expected) => {
      expect(
        shouldEnableViewportGatedEmbeds(eligible, globallyEnabled, shareId)
      ).toBe(expected);
    }
  );
});
