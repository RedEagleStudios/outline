import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  AllowNull,
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
import Fix from "./decorators/Fix";

export interface ExcalidrawScene {
  type: "excalidraw";
  version: number;
  source?: string;
  elements: object[];
  appState?: object;
  files?: Record<string, object>;
}

@Table({
  tableName: "excalidraw_drawing_revisions",
  modelName: "excalidraw_drawing_revision",
})
@Fix
class ExcalidrawDrawingRevision extends IdModel<
  InferAttributes<ExcalidrawDrawingRevision>,
  Partial<InferCreationAttributes<ExcalidrawDrawingRevision>>
> {
  @AllowNull(false)
  @Column(DataType.UUID)
  drawingId: string;

  @ForeignKey(() => Document)
  @AllowNull(false)
  @Column(DataType.UUID)
  documentId: string;

  @ForeignKey(() => Team)
  @AllowNull(false)
  @Column(DataType.UUID)
  teamId: string;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column(DataType.UUID)
  createdById: string;

  @AllowNull(false)
  @Column(DataType.JSONB)
  scene: ExcalidrawScene;

  @AllowNull(true)
  @Column(DataType.TEXT)
  preview: string | null;

  @AllowNull(true)
  @Column(DataType.STRING)
  checksum: string | null;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @BelongsTo(() => User, "createdById")
  createdBy: User;
}

export default ExcalidrawDrawingRevision;
