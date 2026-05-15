import { z } from "zod";
import { BaseSchema } from "../schema";

const DropdownOptionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[^\s}|]+$/),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const DropdownTemplateBodySchema = z.object({
  name: z.string().min(1).max(100),
  options: z.array(DropdownOptionSchema).min(1).max(50),
});

export const DropdownTemplatesListSchema = BaseSchema.extend({
  body: z.object({
    query: z.string().optional(),
  }),
});

export const DropdownTemplatesCreateSchema = BaseSchema.extend({
  body: DropdownTemplateBodySchema,
});

export const DropdownTemplatesUpdateSchema = BaseSchema.extend({
  body: DropdownTemplateBodySchema.extend({
    id: z.uuid(),
  }),
});

export const DropdownTemplatesDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type DropdownTemplatesListReq = z.infer<
  typeof DropdownTemplatesListSchema
>;

export type DropdownTemplatesCreateReq = z.infer<
  typeof DropdownTemplatesCreateSchema
>;

export type DropdownTemplatesUpdateReq = z.infer<
  typeof DropdownTemplatesUpdateSchema
>;

export type DropdownTemplatesDeleteReq = z.infer<
  typeof DropdownTemplatesDeleteSchema
>;
