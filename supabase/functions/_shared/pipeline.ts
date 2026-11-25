// One run of the daily check for one student. Pure logic: every outside
// system (email, Blackboard, calendar, AI) is passed in, so it can be tested.
import type { AiClient } from "./ai.ts";
import { remindersDueToday, writeBriefing, type Briefing, type CalendarItem } from "./briefing.ts";
import { daysBetween, dedupeKey, type Deadline } from "./deadlines.ts";
import { parseFeed } from "./ics.ts";
import { blackboardDeadlines, triageEmails, type Email, type StudentContext, type TriagedEmail } from "./triage.ts";

export interface RunInput {
  ai: AiClient;
  ctx: StudentContext;
  /** Emails received since the last check, from every connected mailbox. */
  emails: Email[];
  /** Raw Blackboard calendar feed, or null when no feed link is set. */
  blackboardFeed: string | null;
  calendarToday: CalendarItem[];
  /** Deadlines already stored, from today on. */
  stored: Deadline[];
  /** dedupe keys of every deadline already stored, past ones included. */
  knownKeys: Set<string>;
  /** Unanswered questions from earlier runs. */
  pendingQuestions: string[];
}

export interface RunResult {
  newDeadlines: (Deadline & { key: string })[];
  emails: TriagedEmail[];
  questions: string[];
  reminders: Deadline[];
  briefing: Briefing;
}

export async function runDailyCheck(input: RunInput): Promise<RunResult> {
  const { ai, ctx } = input;
  const keys = new Set(input.knownKeys);
  const added: (Deadline & { key: string })[] = [];
  const add = (d: Deadline) => {
    const key = dedupeKey(d);
    if (keys.has(key)) return;
    if (daysBetween(ctx.today, d.dueDate) < 0) return; // already past
    keys.add(key);
    added.push({ ...d, key });
  };

  // 1-2. Email: sort it and pull out deadlines.
  const triage = input.emails.length
    ? await triageEmails(ai, input.emails, ctx)
    : { emails: [], deadlines: [], questions: [] };
  triage.deadlines.forEach(add);

  // 3a. Blackboard due dates from the calendar feed. Only items not seen before go to the AI.
  if (input.blackboardFeed) {
    const knownRefs = new Set(input.stored.filter((d) => d.source === "blackboard").map((d) => `${d.sourceRef}|${d.dueDate}`));
    const fresh = parseFeed(input.blackboardFeed, ctx.timeZone).filter(
      (e) => daysBetween(ctx.today, e.date) >= 0 && !knownRefs.has(`${e.uid}|${e.date}`),
    );
    (await blackboardDeadlines(ai, fresh, ctx)).forEach(add);
  }

  const questions = [...new Set([...input.pendingQuestions, ...triage.questions])];
  const upcoming = [...input.stored, ...added];

  // 5-6. Briefing.
  const briefing = await writeBriefing(ai, {
    today: ctx.today,
    calendarToday: input.calendarToday,
    upcoming,
    newDeadlines: added,
    emails: triage.emails,
    questions,
  });

  return {
    newDeadlines: added,
    emails: triage.emails,
    questions,
    reminders: remindersDueToday(upcoming, ctx.today),
    briefing,
  };
}
