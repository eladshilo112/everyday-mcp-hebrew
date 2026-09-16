import { LIMITS, type Finding, type Options, type Result } from "./types.js";

// Input has already been fatally decoded. No field content escapes this module.
export function parseCsv(text: string, options: Options): Result {
  const out: Result = { ok: true, complete: true, status: "complete", records_completed: 0, data_records: 0, expected_columns: null, findings: [], error: null };
  const delimiter = { comma: ",", semicolon: ";", tab: "\t" }[options.delimiter];
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let line = 1, recordLine = 1, fieldLine = 1, field = 1, bytes = 0, value = "", active = false;
  const headers: { value: string; line: number }[] = [];
  function halt(code: string, status: "syntax_error" | "resource_limit"): false {
    out.ok = false; out.complete = false; out.status = status; out.error = { code };
    return false;
  }
  function finding(item: Finding): boolean {
    out.ok = false;
    if (out.findings.length === options.max_findings) return halt("FINDINGS_LIMIT", "resource_limit");
    out.findings.push(item);
    return true;
  }
  function stop(code: string, status: "syntax_error" | "resource_limit"): Result {
    finding({ code, record: out.records_completed + 1, line, field });
    // Syntax takes precedence if the finding budget is already full.
    halt(code, status);
    return out;
  }
  function append(part: string): boolean {
    bytes += Buffer.byteLength(part, "utf8");
    if (bytes > LIMITS.fieldBytes) return false;
    if (out.records_completed === 0 && options.header) value += part;
    return true;
  }
  function finishField(): void {
    if (out.records_completed === 0 && options.header) headers.push({ value, line: fieldLine });
    bytes = 0; value = ""; state = "start";
  }
  function finishRecord(): boolean {
    finishField();
    out.records_completed++;
    out.data_records = out.records_completed - (options.header ? 1 : 0);
    if (out.expected_columns === null) {
      out.expected_columns = field;
      const seen = new Set<string>();
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i]!;
        if (header.value === "" && !finding({ code: "EMPTY_HEADER", record: 1, line: header.line, field: i + 1 })) return false;
        if (seen.has(header.value) && !finding({ code: "DUPLICATE_HEADER", record: 1, line: header.line, field: i + 1 })) return false;
        seen.add(header.value);
      }
      headers.length = 0;
    } else if (field !== out.expected_columns) {
      if (!finding({ code: "COLUMN_COUNT", record: out.records_completed, line: recordLine, expected: out.expected_columns, actual: field })) return false;
    }
    field = 1; active = false;
    return true;
  }
  if (text.length === 0) { finding({ code: "EMPTY_FILE", record: 0, line: 1 }); return out; }
  for (let i = 0; i < text.length;) {
    if (!active && out.records_completed === LIMITS.records) return stop("RECORD_LIMIT", "resource_limit");
    active = true;
    const char = String.fromCodePoint(text.codePointAt(i)!);
    const newline = char === "\n" || char === "\r";
    const crlf = char === "\r" && text[i + 1] === "\n";
    if (char === "\r" && !crlf) return stop("BARE_CR", "syntax_error");
    if (state === "quoted") {
      if (char === '"') state = "closed";
      else {
        if (!append(crlf ? "\r\n" : char)) return stop("FIELD_BYTES_LIMIT", "resource_limit");
        if (newline) line++;
      }
    } else if (state === "closed" && char === '"') {
      if (!append('"')) return stop("FIELD_BYTES_LIMIT", "resource_limit");
      state = "quoted";
    } else if (char === delimiter) {
      if (field === LIMITS.fields) { field++; return stop("FIELD_COUNT_LIMIT", "resource_limit"); }
      finishField(); field++; fieldLine = line;
    } else if (newline) {
      if (!finishRecord()) return out;
      line++; recordLine = line; fieldLine = line;
    } else if (state === "closed") return stop("AFTER_CLOSING_QUOTE", "syntax_error");
    else if (char === '"') {
      if (state !== "start") return stop("BARE_QUOTE", "syntax_error");
      state = "quoted";
    } else {
      state = "plain";
      if (!append(char)) return stop("FIELD_BYTES_LIMIT", "resource_limit");
    }
    i += crlf ? 2 : char.length;
  }
  if (state === "quoted") return stop("UNTERMINATED_QUOTE", "syntax_error");
  if (active) finishRecord();
  return out;
}
