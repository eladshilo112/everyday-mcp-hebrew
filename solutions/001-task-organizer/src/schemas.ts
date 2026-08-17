import * as z from "zod/v4";

export const languageSchema = z.enum(["he", "en"]);
export const languageHintSchema = z.enum(["he", "en", "auto"]);
export const urgencySchema = z.enum(["high", "medium", "low"]);
export const durationSourceSchema = z.enum(["explicit", "default", "capped"]);

export const warningSchema = z
  .object({
    code: z.enum(["empty_input", "duration_defaulted", "duration_capped"]),
    message: z.string(),
    task_id: z.string().nullable()
  })
  .strict();

export const taskSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    original_index: z.number().int().nonnegative(),
    urgency_score: z.number().int().min(0).max(100),
    urgency: urgencySchema,
    estimated_minutes: z.number().int().min(1).max(1440),
    duration_source: durationSourceSchema,
    source_signals: z.array(z.string())
  })
  .strict();

export const scheduleItemSchema = taskSchema
  .extend({
    position: z.number().int().positive(),
    start_offset_min: z.number().int().nonnegative(),
    end_offset_min: z.number().int().positive(),
    start_time: z.string(),
    end_time: z.string(),
    start_day_offset: z.number().int().nonnegative(),
    end_day_offset: z.number().int().nonnegative()
  })
  .strict();

export const unscheduledItemSchema = taskSchema
  .extend({
    reason: z.literal("insufficient_minutes")
  })
  .strict();

export const parseInputSchema = z
  .object({
    raw_text: z
      .string()
      .max(8000)
      .describe("Free-form Hebrew or English tasks. New lines, semicolons, and bullets separate tasks."),
    language_hint: languageHintSchema
      .default("auto")
      .describe("Choose Hebrew, English, or deterministic automatic language detection.")
  })
  .strict();

export const organizeInputSchema = parseInputSchema
  .extend({
    available_minutes: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .describe("Total free minutes available for this schedule, from 0 through 1440."),
    start_time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
      .default("09:00")
      .describe("Local schedule start time in 24-hour HH:MM format. Default: 09:00.")
  })
  .strict();

export const parseResultSchema = z
  .object({
    language: languageSchema,
    tasks: z.array(taskSchema),
    warnings: z.array(warningSchema)
  })
  .strict();

export const organizeResultSchema = z
  .object({
    language: languageSchema,
    schedule: z.array(scheduleItemSchema),
    unscheduled: z.array(unscheduledItemSchema),
    total_tasks: z.number().int().nonnegative(),
    total_minutes_available: z.number().int().nonnegative(),
    total_minutes_used: z.number().int().nonnegative(),
    total_minutes_remaining: z.number().int().nonnegative(),
    warnings: z.array(warningSchema)
  })
  .strict();

export type Language = z.infer<typeof languageSchema>;
export type LanguageHint = z.infer<typeof languageHintSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type ParsedTask = z.infer<typeof taskSchema>;
export type ParseInput = z.infer<typeof parseInputSchema>;
export type OrganizeInput = z.infer<typeof organizeInputSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
export type OrganizeResult = z.infer<typeof organizeResultSchema>;
