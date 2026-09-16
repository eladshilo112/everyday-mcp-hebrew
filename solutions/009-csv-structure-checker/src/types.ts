export const LIMITS = { fileBytes: 5 * 1024 * 1024, records: 100000, fields: 1000, fieldBytes: 256 * 1024, findings: 200 } as const;
export type Options = { delimiter: "comma" | "semicolon" | "tab"; header: boolean; max_findings: number };
export type Finding = { code: string; record: number; line: number; field?: number; expected?: number; actual?: number };
export type Result = {
  ok: boolean; complete: boolean; status: "complete" | "syntax_error" | "resource_limit" | "error";
  records_completed: number; data_records: number; expected_columns: number | null;
  findings: Finding[]; error: { code: string } | null;
};
export function failure(code: string, status: Result["status"] = "error"): Result {
  return { ok: false, complete: false, status, records_completed: 0, data_records: 0, expected_columns: null, findings: [], error: { code } };
}
