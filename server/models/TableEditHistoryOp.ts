import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Document from "./Document";
import TableEditHistoryBatch from "./TableEditHistoryBatch";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import { SkipChangeset } from "./decorators/Changeset";
import Fix from "./decorators/Fix";

@Table({ tableName: "table_edit_history_ops", modelName: "tableEditHistoryOp" })
@Fix
/** Stores an individual table edit history operation. */
class TableEditHistoryOp extends IdModel<
  InferAttributes<TableEditHistoryOp>,
  Partial<InferCreationAttributes<TableEditHistoryOp>>
> {
  @Column
  @SkipChangeset
  tableId: string;

  @Column
  @SkipChangeset
  source: string;

  @Column(DataType.TEXT)
  @SkipChangeset
  operation: string;

  @Column(DataType.DATE)
  @SkipChangeset
  occurredAt: Date;

  @Column
  @SkipChangeset
  rowId: string | null;

  @Column
  @SkipChangeset
  columnId: string | null;

  @Column
  @SkipChangeset
  cellId: string | null;

  @Column(DataType.INTEGER)
  @SkipChangeset
  rowIndexBefore: number | null;

  @Column(DataType.INTEGER)
  @SkipChangeset
  rowIndexAfter: number | null;

  @Column(DataType.INTEGER)
  @SkipChangeset
  columnIndexBefore: number | null;

  @Column(DataType.INTEGER)
  @SkipChangeset
  columnIndexAfter: number | null;

  @Column(DataType.TEXT)
  @SkipChangeset
  oldText: string | null;

  @Column(DataType.TEXT)
  @SkipChangeset
  newText: string | null;

  @Column
  @SkipChangeset
  oldValueHash: string | null;

  @Column
  @SkipChangeset
  newValueHash: string | null;

  @Column(DataType.JSONB)
  @SkipChangeset
  oldAttrs: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  @SkipChangeset
  newAttrs: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  @SkipChangeset
  metadata: Record<string, unknown> | null;

  // associations

  @BelongsTo(() => TableEditHistoryBatch, "batchId")
  batch: TableEditHistoryBatch;

  @ForeignKey(() => TableEditHistoryBatch)
  @Column(DataType.UUID)
  batchId: string;

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

export default TableEditHistoryOp;
