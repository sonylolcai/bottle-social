import { z } from "zod";

export const LanguageSchema = z.string().min(2).max(16);
export const RegionSchema = z.string().min(2).max(32);

export const CreateUserSchema = z.object({
  handle: z.string().min(2).max(32),
  publicKey: z.string().min(32),
  language: LanguageSchema,
  region: RegionSchema,
  isAdult: z.literal(true)
});

export const PersonalityProfileSchema = z.object({
  openness: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  warmth: z.number().int().min(1).max(5),
  curiosity: z.number().int().min(1).max(5),
  pace: z.number().int().min(1).max(5)
});

export const SubmitBottleSchema = z.object({
  content: z.string().trim().min(1).max(1200),
  language: LanguageSchema
});

export const SubmitReplySchema = z.object({
  content: z.string().trim().min(1).max(800)
});

export const ReportSchema = z.object({
  targetType: z.enum(["bottle", "reply"]),
  targetId: z.string().min(8),
  reason: z.string().min(3).max(400)
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type PersonalityProfileInput = z.infer<typeof PersonalityProfileSchema>;
export type SubmitBottleInput = z.infer<typeof SubmitBottleSchema>;
export type SubmitReplyInput = z.infer<typeof SubmitReplySchema>;
export type ReportInput = z.infer<typeof ReportSchema>;
