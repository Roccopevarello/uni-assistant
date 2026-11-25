// Reading the Blackboard calendar feed and writing the "IE Deadlines" calendar feed.
import { addDays, eventDate, eventName, toLocal, type Deadline } from "./deadlines.ts";

export interface FeedEvent {
  uid: string;
  summary: string;
  description: string;
  categories: string[];
  /** Local date YYYY-MM-DD in the user's time zone. */
  date: string;
  /** Local time HH:MM, or null for all-day items. */
  time: string | null;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function escapeText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Turns a DTSTART/DUE value into a local date and time for the user.
 * UTC values ("...Z") are converted to the user's time zone. Values with a
 * TZID or no zone are taken as already local (Blackboard sends UTC).
 */
function parseDateValue(prop: Prop, timeZone: string): { date: string; time: string | null } | null {
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    if (!/^\d{8}$/.test(v)) return null;
    return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const instant = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return toLocal(instant, timeZone);
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

export function parseFeed(text: string, timeZone: string): FeedEvent[] {
  const events: FeedEvent[] = [];
  let current: Prop[] | null = null;
  for (const line of unfold(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) {
        const get = (n: string) => current!.find((p) => p.name === n);
        const start = get("DUE") ?? get("DTSTART");
        const when = start ? parseDateValue(start, timeZone) : null;
        const summary = get("SUMMARY");
        if (when && summary) {
          events.push({
            uid: get("UID")?.value.trim() ?? `${summary.value}|${when.date}`,
            summary: unescapeText(summary.value).trim(),
            description: unescapeText(get("DESCRIPTION")?.value ?? "").trim(),
            categories: current
              .filter((p) => p.name === "CATEGORIES")
              .flatMap((p) => p.value.split(","))
              .map((c) => unescapeText(c).trim())
              .filter(Boolean),
            date: when.date,
            time: when.time,
          });
        }
      }
      current = null;
      continue;
    }
    if (current) {
      const prop = parseLine(line);
      if (prop) current.push(prop);
    }
  }
  return events;
}

/** Folds a content line at 75 octets, as the iCalendar format requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

const compact = (date: string) => date.replace(/-/g, "");

export interface StoredDeadline extends Deadline {
  id: string;
}

/**
 * The "IE Deadlines" calendar people subscribe to. Each deadline is an
 * all-day event 2 days before the real date, with an alarm at its start.
 */
export function buildCalendar(deadlines: StoredDeadline[], opts: { name?: string; now?: Date } = {}): string {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Uni Assistant//Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name ?? "IE Deadlines")}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const d of deadlines) {
    const start = eventDate(d);
    const title = eventName(d);
    const due = d.dueTime ? `${d.dueDate} ${d.dueTime}` : d.dueDate;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.id}@uni-assistant`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(start)}`,
      `DTEND;VALUE=DATE:${compact(addDays(start, 1))}`,
      `SUMMARY:${escapeText(title)}`,
      `DESCRIPTION:${escapeText(`Real deadline: ${due}. Source: ${d.source === "blackboard" ? "Blackboard" : "email"}.`)}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(title)}`,
      "TRIGGER;RELATED=START:PT0S",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
