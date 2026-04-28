import { z } from "zod";

export const ConfigurationItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  class: z.string().min(1),
  environment: z.string().optional(),
  attributes: z.record(z.any()).optional(),
});

export type ConfigurationItem = z.infer<typeof ConfigurationItemSchema>;

export const RelationshipSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  attributes: z.record(z.any()).optional(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

export const CreateCIInputSchema = ConfigurationItemSchema.omit({ id: true }).extend({
  id: z.string().min(1).optional(),
});

export type CreateCIInput = z.infer<typeof CreateCIInputSchema>;

export const UpdateCIInputSchema = ConfigurationItemSchema.partial().omit({ id: true });

export type UpdateCIInput = z.infer<typeof UpdateCIInputSchema>;

export const CreateRelationshipInputSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  attributes: z.record(z.any()).optional(),
});

export type CreateRelationshipInput = z.infer<typeof CreateRelationshipInputSchema>;

export const DeleteRelationshipInputSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
});

export type DeleteRelationshipInput = z.infer<typeof DeleteRelationshipInputSchema>;

export const UpdateRelationshipInputSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  type: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  newType: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).optional(),
  attributes: z.record(z.any()).optional(),
});

export type UpdateRelationshipInput = z.infer<typeof UpdateRelationshipInputSchema>;
