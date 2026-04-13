import { z } from 'zod';

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  triggers: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  category: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
  frontmatter: SkillFrontmatterSchema.optional(),
});
export type SkillInfo = z.infer<typeof SkillInfoSchema>;

export const schemas = {
  SkillInfo: SkillInfoSchema,
  SkillFrontmatter: SkillFrontmatterSchema,
} as const;
