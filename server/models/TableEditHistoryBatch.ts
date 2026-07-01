import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Document from "./Document";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import { SkipChangeset } from "./decorators/Changeset";
import Fix from "./decorators/Fix";

@Table({
  tableName: "table_edit_history_batches",
  modelName: "tableEditHistoryBatch",
})
@Fix
/** Stores a group of table edit history operations from one logical edit. */
class TableEditHistoryBatch extends IdModel<
  InferAttributes<TableEditHistoryBatch>,
  Partial<InferCreationAttributes<TableEditHistoryBatch>>
> {
  @Column
  @SkipChangeset
  tableId: string;

  @Column
  @SkipChangeset
  source: string;

  @Column(DataType.TEXT)
  @SkipChangeset
  operationSummary: string;

  @Column(DataType.INTEGER)
  @SkipChangeset
  opCount: number;

  @Column(DataType.DATE)
  @SkipChangeset
  occurredAt: Date;

  @Column(DataType.DATE)
  @SkipChangeset
  endedAt: Date;

  @Column(DataType.JSONB)
  @SkipChangeset
  metadata: Record<string, unknown> | null;

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => User, "actorId")
  actor: User | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  actorId: string | null;
}

export default TableEditHistoryBatch;
