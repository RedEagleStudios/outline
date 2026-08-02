import { TeamPreference } from "@shared/types";
import stores from "~/stores";
import Team from "./Team";

describe("Team model", () => {
  it("defaults viewport-gated embeds to false", () => {
    const team = new Team(
      {
        id: "team-id",
        preferences: {},
      },
      stores.auth
    );

    expect(team.getPreference(TeamPreference.ViewportGatedEmbeds)).toBe(false);
  });
});
