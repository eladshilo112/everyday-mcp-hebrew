import * as z from "zod/v4";

export const MAX_RETURNED_ITEMS = 500;
export const MAX_CALENDAR_FILES = 50;
export const MAX_FILE_BYTES = 5_000_000;
export const MAX_PARSED_EVENTS = 2_000;
export const MAX_WINDOW_DAYS = 90;
export const MAX_PATH_CHARACTERS = 4_096;

export const errorCodeSchema = z.enum([
  "invalid_input",
  "invalid_path",
  "outside_working_directory",
  "not_found",
  "not_directory",
  "not_file",
  "not_ics_file",
  "symlink_not_allowed",
  "permission_denied",
  "file_too_large",
  "too_many_files",
  "invalid_window",
  "read_failed"
]);

export const toolErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  path: z.string().nullable()
}).strict();

export const warningSchema = z.object({
  code: z.string(),
  source_file: z.string(),
  event_index: z.number().int().positive().nullable(),
  message: z.string()
}).strict();

export const calendarEventSchema = z.object({
  uid: z.string(),
  summary: z.string(),
  start: z.string(),
  end: z.string(),
  all_day: z.boolean(),
  recurring: z.boolean(),
  occurrence_index: z.number().int().nonnegative(),
  source_file: z.string()
}).strict();

export const conflictSchema = z.object({
  overlap_start: z.string(),
  overlap_end: z.string(),
  duration_minutes: z.number().nonnegative(),
  first: calendarEventSchema,
  second: calendarEventSchema
}).strict();

const calendarFilesShape = {
  working_directory: z.string().min(1).max(MAX_PATH_CHARACTERS)
    .describe("Local directory that forms the mandatory path boundary."),
  files: z.array(z.string().min(1).max(MAX_PATH_CHARACTERS)).min(1).max(MAX_CALENDAR_FILES)
    .describe("Relative or absolute paths to local .ics files inside working_directory."),
  window_start: z.string().min(1)
    .describe("Inclusive ISO 8601 window start with Z or a numeric UTC offset."),
  window_end: z.string().min(1)
    .describe("Exclusive ISO 8601 window end, no more than 90 days after window_start.")
};

export const calendarFilesInputSchema = z.object(calendarFilesShape).strict();
export const findConflictsInputSchema = calendarFilesInputSchema;
export const listEventsInputSchema = calendarFilesInputSchema;

const baseResultShape = {
  ok: z.boolean(),
  error: toolErrorSchema.nullable(),
  window_start: z.string().nullable(),
  window_end: z.string().nullable(),
  files_read: z.number().int().nonnegative(),
  warning_count: z.number().int().nonnegative(),
  warnings: z.array(warningSchema).max(MAX_RETURNED_ITEMS),
  warnings_omitted: z.number().int().nonnegative(),
  summary_text: z.string()
};

export const listEventsResultSchema = z.object({
  ...baseResultShape,
  event_count: z.number().int().nonnegative(),
  events_returned: z.number().int().min(0).max(MAX_RETURNED_ITEMS),
  events_omitted: z.number().int().nonnegative(),
  events: z.array(calendarEventSchema).max(MAX_RETURNED_ITEMS)
}).strict();

export const findConflictsResultSchema = z.object({
  ...baseResultShape,
  events_scanned: z.number().int().nonnegative(),
  conflict_count: z.number().int().nonnegative(),
  conflicts_returned: z.number().int().min(0).max(MAX_RETURNED_ITEMS),
  conflicts_omitted: z.number().int().nonnegative(),
  conflicts: z.array(conflictSchema).max(MAX_RETURNED_ITEMS)
}).strict();

const isoInstantSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  "Use ISO 8601 with Z or a numeric UTC offset"
);

export const checkOverlapInputSchema = z.object({
  first_start: isoInstantSchema,
  first_end: isoInstantSchema,
  second_start: isoInstantSchema,
  second_end: isoInstantSchema
}).strict();

export const checkOverlapResultSchema = z.object({
  ok: z.boolean(),
  error: toolErrorSchema.nullable(),
  overlaps: z.boolean(),
  overlap_start: z.string().nullable(),
  overlap_end: z.string().nullable(),
  duration_minutes: z.number().nonnegative(),
  summary_text: z.string()
}).strict();

export type ToolError = z.infer<typeof toolErrorSchema>;
export type CalendarWarning = z.infer<typeof warningSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
export type CalendarFilesInput = z.infer<typeof calendarFilesInputSchema>;
export type ListEventsResult = z.infer<typeof listEventsResultSchema>;
export type FindConflictsResult = z.infer<typeof findConflictsResultSchema>;
export type CheckOverlapInput = z.infer<typeof checkOverlapInputSchema>;
export type CheckOverlapResult = z.infer<typeof checkOverlapResultSchema>;
