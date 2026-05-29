import { DropdownTemplate, Team, User } from "@server/models";
import { allow } from "./cancan";
import { and, isTeamModel, isTeamMutable } from "./utils";

allow(User, "readDropdownTemplate", Team, (actor, team) =>
  and(!actor.isGuest, !actor.isViewer, isTeamModel(actor, team))
);

allow(
  User,
  ["createDropdownTemplate", "updateDropdownTemplate"],
  Team,
  (actor, team) =>
    and(
      !actor.isGuest,
      !actor.isViewer,
      isTeamModel(actor, team),
      isTeamMutable(actor)
    )
);

allow(User, "read", DropdownTemplate, (actor, dropdownTemplate) =>
  and(!actor.isGuest, !actor.isViewer, isTeamModel(actor, dropdownTemplate))
);

allow(User, ["update", "delete"], DropdownTemplate, (actor, dropdownTemplate) =>
  and(
    !actor.isGuest,
    !actor.isViewer,
    isTeamModel(actor, dropdownTemplate),
    isTeamMutable(actor)
  )
);
