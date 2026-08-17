import type { z } from "zod/v4";
import type {
  durationSourceSchema,
  languageHintSchema,
  languageSchema,
  organizeInputSchema,
  organizeResultSchema,
  parseInputSchema,
  parseResultSchema,
  taskSchema,
  warningSchema
} from "./schemas.js";

export type Language = z.infer<typeof languageSchema>;
export type LanguageHint = z.infer<typeof languageHintSchema>;
export type DurationSource = z.infer<typeof durationSourceSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type ParsedTask = z.infer<typeof taskSchema>;
export type ParseInput = z.infer<typeof parseInputSchema>;
export type OrganizeInput = z.infer<typeof organizeInputSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
export type OrganizeResult = z.infer<typeof organizeResultSchema>;
