import type { DropdownTemplate } from "@server/models";

export default function present(dropdownTemplate: DropdownTemplate) {
  return {
    id: dropdownTemplate.id,
    name: dropdownTemplate.name,
    options: dropdownTemplate.options,
    teamId: dropdownTemplate.teamId,
    createdById: dropdownTemplate.createdById,
    updatedById: dropdownTemplate.updatedById,
    createdAt: dropdownTemplate.createdAt,
    updatedAt: dropdownTemplate.updatedAt,
  };
}
