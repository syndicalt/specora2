import { z } from "zod";

export const ConfigurationItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  class: z.string().min(1),
  environment: z.string().optional(),
  attributes: z.record(z.any()).optional(),
});

export type ConfigurationItem = z.infer<typeof ConfigurationItemSchema>;

export const RelationshipSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  attributes: z.record(z.any()).optional(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

export const CreateCIInputSchema = ConfigurationItemSchema.omit({ id: true }).extend({
  id: z.string().uuid().optional(),
});

export type CreateCIInput = z.infer<typeof CreateCIInputSchema>;

export const UpdateCIInputSchema = ConfigurationItemSchema.partial().omit({ id: true });

export type UpdateCIInput = z.infer<typeof UpdateCIInputSchema>;

export const CreateRelationshipInputSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.enum(["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"]),
  attributes: z.record(z.any()).optional(),
});

export type CreateRelationshipInput = z.infer<typeof CreateRelationshipInputSchema>;
