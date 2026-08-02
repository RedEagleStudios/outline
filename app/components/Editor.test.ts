import { shouldEnableViewportGatedEmbeds } from "./EditorPolicy";

describe("shouldEnableViewportGatedEmbeds", () => {
  it.each([
    [false, false, false, undefined, false],
    [true, false, true, undefined, false],
    [true, true, false, undefined, false],
    [true, true, true, undefined, true],
    [true, true, true, "share-id", false],
  ] as const)(
    "with eligibility=%s, global=%s, team=%s, and share=%s returns %s",
    (eligible, globallyEnabled, teamEnabled, shareId, expected) => {
      expect(
        shouldEnableViewportGatedEmbeds(
          eligible,
          globallyEnabled,
          teamEnabled,
          shareId
        )
      ).toBe(expected);
    }
  );
});
