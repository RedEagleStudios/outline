import { z } from "zod";
import { BaseSchema } from "@server/routes/api/schema";
import { zodShareIdType } from "@server/utils/zod";

const MaxSceneBytes = 1024 * 1024;
const MaxElements = 10_000;
const MaxElementBytes = 64 * 1024;

const ElementSchema = z
  .object({}).passthrough()
  .refine((value) => JSON.stringify(value).length <= MaxElementBytes, {
    message: "Element is too large",
  });

const SceneSchema = z.object({
  type: z.literal("excalidraw"),
  version: z.number().int().positive(),
  source: z.string().max(255).optional(),
  elements: ElementSchema.array().max(MaxElements),
  appState: z.object({}).passthrough().optional(),
  files: z.record(z.string(), z.object({}).passthrough()).optional(),
}).refine((value) => JSON.stringify(value).length <= MaxSceneBytes, {
  message: "Scene is too large",
});

export const ExcalidrawCreateSchema = BaseSchema.extend({
  body: z.object({
    documentId: z.uuid(),
    drawingId: z.uuid().optional(),
    baseDrawingRevisionId: z.uuid().nullable().optional(),
    preview: z.string().max(1024 * 1024).nullable().optional(),
    scene: SceneSchema,
  }),
});

export type ExcalidrawCreateReq = z.infer<typeof ExcalidrawCreateSchema>;

export const ExcalidrawInfoSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
    shareId: zodShareIdType().optional(),
  }),
});

export type ExcalidrawInfoReq = z.infer<typeof ExcalidrawInfoSchema>;
