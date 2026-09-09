import { lstat, readFile, realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type {
  CalendarEvent,
  CalendarFilesInput,
  CalendarWarning,
  CheckOverlapInput,
  CheckOverlapResult,
  Conflict,
  FindConflictsResult,
  ListEventsResult,
  ToolError
} from "./schemas.js";
import {
  MAX_FILE_BYTES,
  MAX_PARSED_EVENTS,
  MAX_RETURNED_ITEMS,
  MAX_WINDOW_DAYS
} from "./schemas.js";

const DAY_MS = 86_400_000;
const MAX_RECURRENCE_STEPS = 20_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface ParsedIcsDate {
  epochMs: number;
  parts: DateParts;
  tzid: string | null;
  allDay: boolean;
}

interface ParsedProperty {
  value: string;
  params: Readonly<Record<string, string>>;
}

interface RecurrenceRule {
  frequency: "DAILY" | "WEEKLY";
  interval: number;
  count: number | null;
  untilMs: number | null;
}

interface BaseEvent {
  uid: string;
  summary: string;
  start: ParsedIcsDate;
  end: ParsedIcsDate;
  recurrence: RecurrenceRule | null;
  sourceFile: string;
  eventIndex: number;
}

interface LoadedCalendars {
  events: CalendarEvent[];
  warnings: CalendarWarning[];
  filesRead: number;
  windowStartMs: number;
  windowEndMs: number;
}

class CalendarFailure extends Error {
  readonly error: ToolError;

  constructor(error: ToolError) {
    super(error.message);
    this.error = error;
  }
}

function toolError(code: ToolError["code"], message: string, filePath: string | null): ToolError {
  return { code, message, path: filePath };
}

function nodeErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function throwPathFailure(error: unknown, filePath: string): never {
  const code = nodeErrorCode(error);
  if (code === "ENOENT") {
    throw new CalendarFailure(toolError("not_found", "The local path does not exist.", filePath));
  }
  if (code === "EACCES" || code === "EPERM") {
    throw new CalendarFailure(toolError("permission_denied", "Permission was denied while reading the local path.", filePath));
  }
  throw new CalendarFailure(toolError("read_failed", "The local path could not be read.", filePath));
}

function isNetworkLike(candidate: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || candidate.startsWith("\\\\") || candidate.startsWith("//");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sourceName(root: string, candidate: string): string {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseIsoInstant(value: string): number | null {
  if (!ISO_INSTANT.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWindow(input: CalendarFilesInput): { startMs: number; endMs: number } {
  const startMs = parseIsoInstant(input.window_start);
  const endMs = parseIsoInstant(input.window_end);
  if (startMs === null || endMs === null || endMs <= startMs || endMs - startMs > MAX_WINDOW_DAYS * DAY_MS) {
    throw new CalendarFailure(toolError(
      "invalid_window",
      `The window must use explicit ISO 8601 offsets, have a positive duration, and span at most ${MAX_WINDOW_DAYS} days.`,
      null
    ));
  }
  return { startMs, endMs };
}

async function resolveInputFiles(input: CalendarFilesInput): Promise<Array<{ absolute: string; source: string }>> {
  if (isNetworkLike(input.working_directory)) {
    throw new CalendarFailure(toolError("invalid_path", "Network paths and URLs are not allowed.", input.working_directory));
  }

  const lexicalRoot = path.resolve(input.working_directory);
  let rootInfo: Stats;
  let canonicalRoot: string;
  try {
    rootInfo = await lstat(lexicalRoot);
    canonicalRoot = await realpath(lexicalRoot);
  } catch (error) {
    throwPathFailure(error, lexicalRoot);
  }
  if (rootInfo.isSymbolicLink()) {
    throw new CalendarFailure(toolError("symlink_not_allowed", "The working directory may not be a symbolic link.", lexicalRoot));
  }
  if (!rootInfo.isDirectory()) {
    throw new CalendarFailure(toolError("not_directory", "working_directory must be a local directory.", lexicalRoot));
  }

  const resolved = new Map<string, { absolute: string; source: string }>();
  for (const supplied of input.files) {
    if (isNetworkLike(supplied)) {
      throw new CalendarFailure(toolError("invalid_path", "Network paths and URLs are not allowed.", supplied));
    }
    const lexicalFile = path.isAbsolute(supplied) ? path.resolve(supplied) : path.resolve(canonicalRoot, supplied);
    if (!isInside(canonicalRoot, lexicalFile)) {
      throw new CalendarFailure(toolError(
        "outside_working_directory",
        "The calendar path resolves outside working_directory.",
        supplied
      ));
    }
    if (path.extname(lexicalFile).toLowerCase() !== ".ics") {
      throw new CalendarFailure(toolError("not_ics_file", "Only .ics calendar files are accepted.", supplied));
    }

    let fileInfo: Stats;
    let canonicalFile: string;
    try {
      fileInfo = await lstat(lexicalFile);
      canonicalFile = await realpath(lexicalFile);
    } catch (error) {
      throwPathFailure(error, lexicalFile);
    }
    if (fileInfo.isSymbolicLink()) {
      throw new CalendarFailure(toolError("symlink_not_allowed", "Calendar file symlinks are not allowed.", supplied));
    }
    if (!fileInfo.isFile()) {
      throw new CalendarFailure(toolError("not_file", "Each calendar path must be a regular file.", supplied));
    }
    if (!isInside(canonicalRoot, canonicalFile)) {
      throw new CalendarFailure(toolError(
        "outside_working_directory",
        "The calendar file resolves outside working_directory.",
        supplied
      ));
    }
    if (fileInfo.size > MAX_FILE_BYTES) {
      throw new CalendarFailure(toolError(
        "file_too_large",
        `Each calendar file is limited to ${MAX_FILE_BYTES} bytes.`,
        supplied
      ));
    }
    const source = sourceName(canonicalRoot, canonicalFile);
    resolved.set(canonicalFile, { absolute: canonicalFile, source });
  }

  return [...resolved.values()].sort((left, right) => compareText(left.source, right.source));
}

function unfoldLines(content: string): string[] {
  const physical = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      const previous = unfolded[unfolded.length - 1];
      if (previous !== undefined) {
        unfolded[unfolded.length - 1] = previous + line.slice(1);
      }
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function parseProperty(line: string): { name: string; property: ParsedProperty } | null {
  const colon = line.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const left = line.slice(0, colon).split(";");
  const rawName = left.shift();
  if (rawName === undefined) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const rawParam of left) {
    const equals = rawParam.indexOf("=");
    if (equals > 0) {
      params[rawParam.slice(0, equals).toUpperCase()] = rawParam.slice(equals + 1).replace(/^"|"$/g, "");
    }
  }
  return {
    name: rawName.toUpperCase(),
    property: { value: line.slice(colon + 1), params }
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validParts(parts: DateParts): boolean {
  if (parts.year < 1970 || parts.year > 9999 || parts.month < 1 || parts.month > 12) {
    return false;
  }
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    return false;
  }
  return parts.hour >= 0 && parts.hour <= 23 && parts.minute >= 0 && parts.minute <= 59 && parts.second >= 0 && parts.second <= 59;
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (occurrence - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = daysInMonth(year, month);
  const lastDayWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((lastDayWeekday - weekday + 7) % 7);
}

function isAfterLocal(parts: DateParts, month: number, day: number, hour: number): boolean {
  if (parts.month !== month) {
    return parts.month > month;
  }
  if (parts.day !== day) {
    return parts.day > day;
  }
  return parts.hour >= hour;
}

function isBeforeLocal(parts: DateParts, month: number, day: number, hour: number): boolean {
  if (parts.month !== month) {
    return parts.month < month;
  }
  if (parts.day !== day) {
    return parts.day < day;
  }
  return parts.hour < hour;
}

function betweenLocal(
  parts: DateParts,
  startMonth: number,
  startDay: number,
  startHour: number,
  endMonth: number,
  endDay: number,
  endHour: number
): boolean {
  return isAfterLocal(parts, startMonth, startDay, startHour) && isBeforeLocal(parts, endMonth, endDay, endHour);
}

function timezoneOffsetMinutes(tzid: string, parts: DateParts): number | null {
  const normalized = tzid.replace(/^\//, "");
  if (["UTC", "GMT", "Etc/UTC", "Etc/GMT"].includes(normalized)) return 0;
  if (["Asia/Kolkata", "Asia/Calcutta"].includes(normalized)) return 330;
  if (normalized === "Asia/Tokyo") return 540;
  if (normalized === "Asia/Jerusalem") {
    const startDay = lastWeekday(parts.year, 3, 5);
    const endDay = lastWeekday(parts.year, 10, 0);
    return betweenLocal(parts, 3, startDay, 2, 10, endDay, 2) ? 180 : 120;
  }
  if (normalized === "Europe/London") {
    const startDay = lastWeekday(parts.year, 3, 0);
    const endDay = lastWeekday(parts.year, 10, 0);
    return betweenLocal(parts, 3, startDay, 1, 10, endDay, 2) ? 60 : 0;
  }
  if (["Europe/Berlin", "Europe/Paris"].includes(normalized)) {
    const startDay = lastWeekday(parts.year, 3, 0);
    const endDay = lastWeekday(parts.year, 10, 0);
    return betweenLocal(parts, 3, startDay, 2, 10, endDay, 3) ? 120 : 60;
  }
  if (normalized === "America/New_York") {
    const startDay = nthWeekday(parts.year, 3, 0, 2);
    const endDay = nthWeekday(parts.year, 11, 0, 1);
    return betweenLocal(parts, 3, startDay, 2, 11, endDay, 2) ? -240 : -300;
  }
  if (normalized === "America/Los_Angeles") {
    const startDay = nthWeekday(parts.year, 3, 0, 2);
    const endDay = nthWeekday(parts.year, 11, 0, 1);
    return betweenLocal(parts, 3, startDay, 2, 11, endDay, 2) ? -420 : -480;
  }
  return null;
}

function parseIcsDate(property: ParsedProperty, inheritedTzid: string | null = null): ParsedIcsDate | null {
  const value = property.value.trim();
  const isDateOnly = property.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(value);
  let match: RegExpMatchArray | null;
  if (isDateOnly) {
    match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  } else {
    match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  }
  if (match === null) return null;

  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: isDateOnly ? 0 : Number(match[4]),
    minute: isDateOnly ? 0 : Number(match[5]),
    second: isDateOnly ? 0 : Number(match[6] ?? 0)
  };
  if (!validParts(parts)) return null;

  const isUtc = !isDateOnly && match[7]?.toUpperCase() === "Z";
  const tzid = isUtc || isDateOnly ? null : (property.params.TZID ?? inheritedTzid);
  let offset = 0;
  if (tzid !== null) {
    const knownOffset = timezoneOffsetMinutes(tzid, parts);
    if (knownOffset === null) return null;
    offset = knownOffset;
  }
  const epochMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - offset * 60_000;
  return { epochMs, parts, tzid, allDay: isDateOnly };
}

function addCalendarDays(value: ParsedIcsDate, days: number): ParsedIcsDate {
  const calendar = new Date(Date.UTC(
    value.parts.year,
    value.parts.month - 1,
    value.parts.day + days,
    value.parts.hour,
    value.parts.minute,
    value.parts.second
  ));
  const parts: DateParts = {
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
    hour: calendar.getUTCHours(),
    minute: calendar.getUTCMinutes(),
    second: calendar.getUTCSeconds()
  };
  const offset = value.tzid === null ? 0 : (timezoneOffsetMinutes(value.tzid, parts) ?? 0);
  return {
    epochMs: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - offset * 60_000,
    parts,
    tzid: value.tzid,
    allDay: value.allDay
  };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function warning(code: string, sourceFile: string, eventIndex: number | null, message: string): CalendarWarning {
  return { code, source_file: sourceFile, event_index: eventIndex, message };
}

function parseRecurrence(
  property: ParsedProperty,
  start: ParsedIcsDate,
  sourceFile: string,
  eventIndex: number,
  warnings: CalendarWarning[]
): RecurrenceRule | null {
  const values: Record<string, string> = {};
  for (const part of property.value.split(";")) {
    const equals = part.indexOf("=");
    if (equals > 0) values[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1);
  }
  const frequency = values.FREQ?.toUpperCase();
  if (frequency !== "DAILY" && frequency !== "WEEKLY") {
    warnings.push(warning("unsupported_rrule", sourceFile, eventIndex, "Only DAILY and WEEKLY RRULE frequencies are expanded; the base event was kept."));
    return null;
  }
  const interval = values.INTERVAL === undefined ? 1 : Number(values.INTERVAL);
  const count = values.COUNT === undefined ? null : Number(values.COUNT);
  if (!Number.isInteger(interval) || interval < 1 || (count !== null && (!Number.isInteger(count) || count < 1))) {
    warnings.push(warning("invalid_rrule", sourceFile, eventIndex, "The RRULE interval or count is invalid; the base event was kept."));
    return null;
  }

  let untilMs: number | null = null;
  if (values.UNTIL !== undefined) {
    const until = parseIcsDate({ value: values.UNTIL, params: {} }, start.tzid);
    if (until === null) {
      warnings.push(warning("invalid_rrule_until", sourceFile, eventIndex, "The RRULE UNTIL value is invalid; the base event was kept."));
      return null;
    }
    untilMs = until.epochMs;
  }
  return { frequency, interval, count, untilMs };
}

function parseBaseEvents(content: string, sourceFile: string, warnings: CalendarWarning[]): BaseEvent[] {
  const lines = unfoldLines(content);
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
    } else if (upper === "END:VEVENT" && current !== null) {
      blocks.push(current);
      current = null;
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) {
    warnings.push(warning("unterminated_event", sourceFile, blocks.length + 1, "An unterminated VEVENT block was skipped."));
  }

  const events: BaseEvent[] = [];
  blocks.forEach((block, offset) => {
    const eventIndex = offset + 1;
    const properties = new Map<string, ParsedProperty>();
    for (const line of block) {
      const parsed = parseProperty(line);
      if (parsed !== null && !properties.has(parsed.name)) {
        properties.set(parsed.name, parsed.property);
      }
    }
    const startProperty = properties.get("DTSTART");
    const endProperty = properties.get("DTEND");
    if (startProperty === undefined) {
      warnings.push(warning("missing_dtstart", sourceFile, eventIndex, "VEVENT is missing DTSTART and was skipped."));
      return;
    }
    if (endProperty === undefined) {
      warnings.push(warning("missing_dtend", sourceFile, eventIndex, "VEVENT is missing DTEND and was skipped."));
      return;
    }
    const start = parseIcsDate(startProperty);
    const end = parseIcsDate(endProperty, start?.tzid ?? null);
    if (start === null || end === null) {
      const hasUnknownTimezone = (startProperty.params.TZID !== undefined && timezoneOffsetMinutes(startProperty.params.TZID, {
        year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0
      }) === null) || (endProperty.params.TZID !== undefined && timezoneOffsetMinutes(endProperty.params.TZID, {
        year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0
      }) === null);
      warnings.push(warning(
        hasUnknownTimezone ? "unsupported_timezone" : "invalid_date",
        sourceFile,
        eventIndex,
        hasUnknownTimezone ? "VEVENT uses an unsupported TZID and was skipped." : "VEVENT has an invalid DTSTART or DTEND and was skipped."
      ));
      return;
    }
    if (start.allDay !== end.allDay) {
      warnings.push(warning("mixed_date_types", sourceFile, eventIndex, "DTSTART and DTEND must both be DATE-only or both date-time values; VEVENT was skipped."));
      return;
    }
    if (end.epochMs <= start.epochMs) {
      warnings.push(warning("invalid_range", sourceFile, eventIndex, "VEVENT end time must be after its start time; VEVENT was skipped."));
      return;
    }
    if (start.tzid === null && !start.allDay && !startProperty.value.trim().toUpperCase().endsWith("Z")) {
      warnings.push(warning("floating_time_assumed_utc", sourceFile, eventIndex, "A floating date-time without TZID was interpreted as UTC."));
    }

    const uidProperty = properties.get("UID");
    const uid = uidProperty === undefined || uidProperty.value.trim() === ""
      ? `${sourceFile}#event-${eventIndex}`
      : unescapeText(uidProperty.value);
    if (uidProperty === undefined || uidProperty.value.trim() === "") {
      warnings.push(warning("missing_uid", sourceFile, eventIndex, "VEVENT has no UID; a stable local identifier was assigned."));
    }
    const summary = unescapeText(properties.get("SUMMARY")?.value ?? "(ללא כותרת)");
    const recurrenceProperty = properties.get("RRULE");
    const recurrence = recurrenceProperty === undefined
      ? null
      : parseRecurrence(recurrenceProperty, start, sourceFile, eventIndex, warnings);
    events.push({ uid, summary, start, end, recurrence, sourceFile, eventIndex });
  });
  return events;
}

function toCalendarEvent(base: BaseEvent, start: ParsedIcsDate, end: ParsedIcsDate, occurrenceIndex: number): CalendarEvent {
  return {
    uid: base.uid,
    summary: base.summary,
    start: new Date(start.epochMs).toISOString(),
    end: new Date(end.epochMs).toISOString(),
    all_day: start.allDay,
    recurring: base.recurrence !== null,
    occurrence_index: occurrenceIndex,
    source_file: base.sourceFile
  };
}

function eventTimes(event: CalendarEvent): { startMs: number; endMs: number } {
  return { startMs: Date.parse(event.start), endMs: Date.parse(event.end) };
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  return Date.parse(left.start) - Date.parse(right.start) ||
    compareText(left.source_file, right.source_file) ||
    compareText(left.uid, right.uid) ||
    left.occurrence_index - right.occurrence_index ||
    Date.parse(left.end) - Date.parse(right.end) ||
    compareText(left.summary, right.summary);
}

function expandEvent(base: BaseEvent, windowStartMs: number, windowEndMs: number): CalendarEvent[] {
  if (base.recurrence === null) {
    return base.start.epochMs < windowEndMs && base.end.epochMs > windowStartMs
      ? [toCalendarEvent(base, base.start, base.end, 0)]
      : [];
  }

  const daysPerOccurrence = base.recurrence.frequency === "DAILY" ? base.recurrence.interval : 7 * base.recurrence.interval;
  const approximateStep = daysPerOccurrence * DAY_MS;
  const firstIndex = Math.max(0, Math.floor((windowStartMs - base.end.epochMs) / approximateStep) - 2);
  const expanded: CalendarEvent[] = [];
  for (let index = firstIndex, steps = 0; steps < MAX_RECURRENCE_STEPS; index += 1, steps += 1) {
    if (base.recurrence.count !== null && index >= base.recurrence.count) break;
    const days = index * daysPerOccurrence;
    const start = addCalendarDays(base.start, days);
    const end = addCalendarDays(base.end, days);
    if (base.recurrence.untilMs !== null && start.epochMs > base.recurrence.untilMs) break;
    if (start.epochMs >= windowEndMs) break;
    if (start.epochMs < windowEndMs && end.epochMs > windowStartMs) {
      expanded.push(toCalendarEvent(base, start, end, index));
    }
  }
  return expanded;
}

function compareWarnings(left: CalendarWarning, right: CalendarWarning): number {
  return compareText(left.source_file, right.source_file) ||
    (left.event_index ?? 0) - (right.event_index ?? 0) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message);
}

async function loadCalendars(input: CalendarFilesInput): Promise<LoadedCalendars> {
  const window = parseWindow(input);
  const files = await resolveInputFiles(input);
  const warnings: CalendarWarning[] = [];
  const events: CalendarEvent[] = [];
  let eventLimitReported = false;

  for (const file of files) {
    let currentSize: number;
    let content: string;
    try {
      currentSize = (await stat(file.absolute)).size;
      if (currentSize > MAX_FILE_BYTES) {
        throw new CalendarFailure(toolError("file_too_large", `Each calendar file is limited to ${MAX_FILE_BYTES} bytes.`, file.source));
      }
      content = await readFile(file.absolute, "utf8");
    } catch (error) {
      if (error instanceof CalendarFailure) throw error;
      throwPathFailure(error, file.source);
    }
    const bases = parseBaseEvents(content, file.source, warnings);
    for (const base of bases) {
      const occurrences = expandEvent(base, window.startMs, window.endMs);
      for (const occurrence of occurrences) {
        if (events.length < MAX_PARSED_EVENTS) {
          events.push(occurrence);
        } else if (!eventLimitReported) {
          warnings.push(warning(
            "event_limit_reached",
            file.source,
            base.eventIndex,
            `Only the first ${MAX_PARSED_EVENTS} expanded events in deterministic file order were analyzed.`
          ));
          eventLimitReported = true;
        }
      }
    }
  }

  events.sort(compareEvents);
  warnings.sort(compareWarnings);
  return {
    events,
    warnings,
    filesRead: files.length,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs
  };
}

function boundedWarnings(warnings: CalendarWarning[]): { returned: CalendarWarning[]; omitted: number } {
  const returned = warnings.slice(0, MAX_RETURNED_ITEMS);
  return { returned, omitted: warnings.length - returned.length };
}

function failedList(error: ToolError): ListEventsResult {
  return {
    ok: false,
    error,
    window_start: null,
    window_end: null,
    files_read: 0,
    warning_count: 0,
    warnings: [],
    warnings_omitted: 0,
    event_count: 0,
    events_returned: 0,
    events_omitted: 0,
    events: [],
    summary_text: error.message
  };
}

function failedConflicts(error: ToolError): FindConflictsResult {
  return {
    ok: false,
    error,
    window_start: null,
    window_end: null,
    files_read: 0,
    warning_count: 0,
    warnings: [],
    warnings_omitted: 0,
    events_scanned: 0,
    conflict_count: 0,
    conflicts_returned: 0,
    conflicts_omitted: 0,
    conflicts: [],
    summary_text: error.message
  };
}

export async function listEvents(input: CalendarFilesInput): Promise<ListEventsResult> {
  try {
    const loaded = await loadCalendars(input);
    const events = loaded.events.slice(0, MAX_RETURNED_ITEMS);
    const warningResult = boundedWarnings(loaded.warnings);
    return {
      ok: true,
      error: null,
      window_start: new Date(loaded.windowStartMs).toISOString(),
      window_end: new Date(loaded.windowEndMs).toISOString(),
      files_read: loaded.filesRead,
      warning_count: loaded.warnings.length,
      warnings: warningResult.returned,
      warnings_omitted: warningResult.omitted,
      event_count: loaded.events.length,
      events_returned: events.length,
      events_omitted: loaded.events.length - events.length,
      events,
      summary_text: `Parsed ${loaded.events.length} event occurrence(s) from ${loaded.filesRead} local calendar file(s).`
    };
  } catch (error) {
    return failedList(error instanceof CalendarFailure ? error.error : toolError("read_failed", "Calendar processing failed.", null));
  }
}

function conflictFor(first: CalendarEvent, second: CalendarEvent): Conflict | null {
  const firstTimes = eventTimes(first);
  const secondTimes = eventTimes(second);
  const overlapStart = Math.max(firstTimes.startMs, secondTimes.startMs);
  const overlapEnd = Math.min(firstTimes.endMs, secondTimes.endMs);
  if (overlapStart >= overlapEnd) return null;
  return {
    overlap_start: new Date(overlapStart).toISOString(),
    overlap_end: new Date(overlapEnd).toISOString(),
    duration_minutes: (overlapEnd - overlapStart) / 60_000,
    first,
    second
  };
}

function compareConflicts(left: Conflict, right: Conflict): number {
  return Date.parse(left.overlap_start) - Date.parse(right.overlap_start) ||
    compareText(left.first.source_file, right.first.source_file) ||
    compareText(left.second.source_file, right.second.source_file) ||
    compareText(left.first.uid, right.first.uid) ||
    compareText(left.second.uid, right.second.uid) ||
    left.first.occurrence_index - right.first.occurrence_index ||
    left.second.occurrence_index - right.second.occurrence_index;
}

function retainBoundedConflict(conflicts: Conflict[], conflict: Conflict): void {
  let low = 0;
  let high = conflicts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const current = conflicts[middle];
    if (current !== undefined && compareConflicts(current, conflict) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (low < MAX_RETURNED_ITEMS) {
    conflicts.splice(low, 0, conflict);
    if (conflicts.length > MAX_RETURNED_ITEMS) conflicts.pop();
  }
}

export async function findConflicts(input: CalendarFilesInput): Promise<FindConflictsResult> {
  try {
    const loaded = await loadCalendars(input);
    const conflicts: Conflict[] = [];
    let conflictCount = 0;
    for (let firstIndex = 0; firstIndex < loaded.events.length; firstIndex += 1) {
      const first = loaded.events[firstIndex];
      if (first === undefined) continue;
      const firstEnd = Date.parse(first.end);
      for (let secondIndex = firstIndex + 1; secondIndex < loaded.events.length; secondIndex += 1) {
        const second = loaded.events[secondIndex];
        if (second === undefined) continue;
        if (Date.parse(second.start) >= firstEnd) break;
        const conflict = conflictFor(first, second);
        if (conflict !== null) {
          conflictCount += 1;
          retainBoundedConflict(conflicts, conflict);
        }
      }
    }
    const warningResult = boundedWarnings(loaded.warnings);
    return {
      ok: true,
      error: null,
      window_start: new Date(loaded.windowStartMs).toISOString(),
      window_end: new Date(loaded.windowEndMs).toISOString(),
      files_read: loaded.filesRead,
      warning_count: loaded.warnings.length,
      warnings: warningResult.returned,
      warnings_omitted: warningResult.omitted,
      events_scanned: loaded.events.length,
      conflict_count: conflictCount,
      conflicts_returned: conflicts.length,
      conflicts_omitted: conflictCount - conflicts.length,
      conflicts,
      summary_text: `Found ${conflictCount} conflict(s) among ${loaded.events.length} event occurrence(s).`
    };
  } catch (error) {
    return failedConflicts(error instanceof CalendarFailure ? error.error : toolError("read_failed", "Calendar processing failed.", null));
  }
}

export function checkOverlap(input: CheckOverlapInput): CheckOverlapResult {
  const firstStart = parseIsoInstant(input.first_start);
  const firstEnd = parseIsoInstant(input.first_end);
  const secondStart = parseIsoInstant(input.second_start);
  const secondEnd = parseIsoInstant(input.second_end);
  if (firstStart === null || firstEnd === null || secondStart === null || secondEnd === null || firstEnd <= firstStart || secondEnd <= secondStart) {
    const error = toolError("invalid_input", "Each interval must use explicit ISO 8601 offsets and end after it starts.", null);
    return {
      ok: false,
      error,
      overlaps: false,
      overlap_start: null,
      overlap_end: null,
      duration_minutes: 0,
      summary_text: error.message
    };
  }
  const overlapStart = Math.max(firstStart, secondStart);
  const overlapEnd = Math.min(firstEnd, secondEnd);
  const overlaps = overlapStart < overlapEnd;
  return {
    ok: true,
    error: null,
    overlaps,
    overlap_start: overlaps ? new Date(overlapStart).toISOString() : null,
    overlap_end: overlaps ? new Date(overlapEnd).toISOString() : null,
    duration_minutes: overlaps ? (overlapEnd - overlapStart) / 60_000 : 0,
    summary_text: overlaps ? "The intervals overlap." : "The intervals do not overlap."
  };
}
