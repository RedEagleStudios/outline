import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import type { DropdownOption } from "@shared/editor/lib/dropdowns";
import Team from "./Team";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";
import Length from "./validators/Length";

/**
 * Workspace-level reusable dropdown template.
 */
@Table({ tableName: "dropdown_templates", modelName: "dropdownTemplate" })
@Fix
class DropdownTemplate extends ParanoidModel<
  InferAttributes<DropdownTemplate>,
  Partial<InferCreationAttributes<DropdownTemplate>>
> {
  static eventNamespace = "dropdownTemplates";

  @Length({
    min: 1,
    max: 100,
    msg: "Dropdown template name must be between 1 and 100 characters",
  })
  @Column(DataType.STRING)
  name: string;

  @Column(DataType.JSONB)
  options: DropdownOption[];

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => User, "updatedById")
  updatedBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  updatedById: string;
}

export default DropdownTemplate;
