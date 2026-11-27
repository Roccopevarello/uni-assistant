// Deadline rules carried over from the Mac "daily uni check":
// - the calendar event is an all-day event 2 days BEFORE the real deadline
// - its alarm fires at the event start
// - a separate reminder goes out 3 days before the deadline
// - event name: "[Course] — [Task]: [action] on [Day DD/MM]" + " by HH:MM" when there is a time

export interface Deadline {
  course: string;
  task: string;
  action: string;
  /** Local date of the real deadline, YYYY-MM-DD, in the user's time zone. */
  dueDate: string;
  /** Local time HH:MM, or null when only a day is known. */
  dueTime: string | null;
  source: "email" | "blackboard";
  /** Blackboard calendar UID or email message id, when known. */
  sourceRef?: string | null;
}

export const EVENT_DAYS_BEFORE = 2;
export const REMINDER_DAYS_BEFORE = 3;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`Not a valid date: ${date}`);
  }
}

/** Adds days to a YYYY-MM-DD date and returns YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  assertDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  assertDate(from);
  assertDate(to);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Fri 05/12" */
export function dayLabel(date: string): string {
  assertDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function eventName(d: Pick<Deadline, "course" | "task" | "action" | "dueDate" | "dueTime">): string {
  const base = `${d.course.trim()} — ${d.task.trim()}: ${d.action.trim()} on ${dayLabel(d.dueDate)}`;
  return d.dueTime ? `${base} by ${d.dueTime}` : base;
}

export function eventDate(d: Pick<Deadline, "dueDate">): string {
  return addDays(d.dueDate, -EVENT_DAYS_BEFORE);
}

export function reminderDate(d: Pick<Deadline, "dueDate">): string {
  return addDays(d.dueDate, -REMINDER_DAYS_BEFORE);
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Key used to avoid adding the same deadline twice ("check first that the same
 * event doesn't already exist"). Matches by course + task + date, like the
 * original check, so the same deadline found in an email and on Blackboard is
 * stored once.
 */
export function dedupeKey(d: Pick<Deadline, "course" | "task" | "dueDate">): string {
  return `${norm(d.course)}|${norm(d.task)}|${d.dueDate}`;
}

export function isValidTime(t: string | null | undefined): t is string {
  return typeof t === "string" && TIME_RE.test(t);
}

export function isValidDate(d: string | null | undefined): d is string {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  return !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
}

/** Today's date (YYYY-MM-DD) and hour (0-23) in a time zone. */
export function localNow(timeZone: string, now: Date = new Date()): { date: string; hour: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour, time: `${get("hour")}:${get("minute")}` };
}

/** Converts an instant to a local date and time in a time zone. */
export function toLocal(instant: Date, timeZone: string): { date: string; time: string } {
  const { date, time } = localNow(timeZone, instant);
  return { date, time };
}
