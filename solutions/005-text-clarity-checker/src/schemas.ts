import * as z from "zod/v4";

export const MAX_INPUT_CHARACTERS = 200_000;
export const MAX_FILE_PATH_CHARACTERS = 4_096;
export const LONG_SENTENCE_WORDS = 40;
export const MAX_EXCERPT_CHARACTERS = 240;
export const MAX_RETURNED_ITEMS = 500;

export const sourceKindSchema = z.enum(["text", "file"]);
export const clarityLabelSchema = z.enum(["ללא טקסט", "ברור", "דורש שיפור", "קשה לקריאה"]);
export const issueTypeSchema = z.enum(["long_sentence", "passive_voice", "complex_term"]);
export const issueTypeHebrewSchema = z.enum(["משפט ארוך", "ניסוח פסיבי", "מונח מסובך"]);

export const toolErrorCodeSchema = z.enum([
  "invalid_input",
  "invalid_path",
  "network_path_not_allowed",
  "not_found",
  "not_file",
  "symlink_not_allowed",
  "permission_denied",
  "invalid_encoding",
  "input_too_large",
  "read_failed"
]);

export const toolErrorSchema = z
  .object({
    code: toolErrorCodeSchema,
    message: z.string(),
    path: z.string().nullable()
  })
  .strict();

export const textSourceInputSchema = z
  .object({
    text: z
      .string()
      .optional()
      .describe("Text to analyze locally. Supply exactly one of text or file_path."),
    file_path: z
      .string()
      .optional()
      .describe("Path to one local UTF-8 regular file to read without changing it. Supply exactly one source.")
  })
  .strict();

export const checkClarityInputSchema = textSourceInputSchema;
export const listIssuesInputSchema = textSourceInputSchema;

export const clarityIssueSchema = z
  .object({
    line: z.number().int().positive(),
    type: issueTypeSchema,
    type_he: issueTypeHebrewSchema,
    sentence: z.string(),
    word_count: z.number().int().nonnegative(),
    match: z.string().nullable(),
    message_he: z.string()
  })
  .strict();

export const complexSentenceSchema = z
  .object({
    line: z.number().int().positive(),
    text: z.string(),
    word_count: z.number().int().nonnegative(),
    issue_types: z.array(issueTypeSchema)
  })
  .strict();

export const checkClarityResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    source_kind: sourceKindSchema.nullable(),
    source_path: z.string().nullable(),
    character_count: z.number().int().nonnegative(),
    word_count: z.number().int().nonnegative(),
    sentence_count: z.number().int().nonnegative(),
    average_sentence_length: z.number().nonnegative(),
    clarity_score: z.number().int().min(0).max(100),
    clarity_label: clarityLabelSchema,
    long_sentence_count: z.number().int().nonnegative(),
    passive_count: z.number().int().nonnegative(),
    complex_term_count: z.number().int().nonnegative(),
    issue_count: z.number().int().nonnegative(),
    complex_sentence_count: z.number().int().nonnegative(),
    complex_sentences_returned: z.number().int().min(0).max(MAX_RETURNED_ITEMS),
    complex_sentences_omitted: z.number().int().nonnegative(),
    complex_sentences: z.array(complexSentenceSchema).max(MAX_RETURNED_ITEMS),
    summary_text: z.string()
  })
  .strict();

export const listIssuesResultSchema = z
  .object({
    ok: z.boolean(),
    error: toolErrorSchema.nullable(),
    source_kind: sourceKindSchema.nullable(),
    source_path: z.string().nullable(),
    character_count: z.number().int().nonnegative(),
    issue_count: z.number().int().nonnegative(),
    issues_returned: z.number().int().min(0).max(MAX_RETURNED_ITEMS),
    issues_omitted: z.number().int().nonnegative(),
    issues: z.array(clarityIssueSchema).max(MAX_RETURNED_ITEMS),
    summary_text: z.string()
  })
  .strict();

export type SourceKind = z.infer<typeof sourceKindSchema>;
export type ClarityLabel = z.infer<typeof clarityLabelSchema>;
export type IssueType = z.infer<typeof issueTypeSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type TextSourceInput = z.infer<typeof textSourceInputSchema>;
export type ClarityIssue = z.infer<typeof clarityIssueSchema>;
export type ComplexSentence = z.infer<typeof complexSentenceSchema>;
export type CheckClarityResult = z.infer<typeof checkClarityResultSchema>;
export type ListIssuesResult = z.infer<typeof listIssuesResultSchema>;
