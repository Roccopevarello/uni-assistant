// The daily uni check. Called every hour by the scheduler (x-cron-secret header),
// it runs once a day per student at their briefing hour. A signed-in student can
// also call it to run their own check right away.
import { AiKeyError, createAiClient, type AiProvider } from "../_shared/ai.ts";
import type { CalendarItem } from "../_shared/briefing.ts";
import { decrypt, encrypt } from "../_shared/crypto.ts";
import { eventName, localNow, type Deadline } from "../_shared/deadlines.ts";
import { fetchMail, fetchTodayEvents, MailAuthError, refreshAccess, type MailProvider } from "../_shared/mail.ts";
import { runDailyCheck } from "../_shared/pipeline.ts";
import type { Email } from "../_shared/triage.ts";
import {
  adminClient,
  checkFeedUrl,
  encryptionKey,
  env,
  HttpError,
  json,
  oauthApp,
  requireUser,
  sendPush,
  serve,
} from "../_shared/server.ts";

/** Stop starting new students after this long, so one call stays inside the function time limit. */
const TIME_BUDGET_MS = 300_000;
const UNIVERSITY = Deno.env.get("UNIVERSITY_NAME") ?? "IE University";

interface Profile {
  user_id: string;
  time_zone: string;
  briefing_hour: number;
  courses: string[];
  ai_provider: AiProvider | null;
  ai_model: string | null;
  ai_key_enc: string | null;
  blackboard_feed_enc: string | null;
  expo_push_token: string | null;
  last_mail_check: string | null;
  last_run_date: string | null;
  pending_questions: string[];
}

const PROFILE_COLUMNS =
  "user_id, time_zone, briefing_hour, courses, ai_provider, ai_model, ai_key_enc, blackboard_feed_enc, expo_push_token, last_mail_check, last_run_date, pending_questions";

function toDeadline(row: Record<string, string | null>): Deadline {
  return {
    course: row.course!,
    task: row.task!,
    action: row.action!,
    dueDate: row.due_date!,
    dueTime: row.due_time,
    source: row.source as Deadline["source"],
    sourceRef: row.source_ref,
  };
}

async function runForStudent(p: Profile): Promise<{ ok: boolean; message: string }> {
  const db = adminClient();
  const key = encryptionKey();
  const startedAt = new Date();
  const { date: today } = localNow(p.time_zone, startedAt);
  const warnings: string[] = [];
  let mailboxFailed = false;

  const fail = async (message: string) => {
    await db.from("profiles").update({ last_run_error: message }).eq("user_id", p.user_id);
    return { ok: false, message };
  };
  if (!p.ai_provider || !p.ai_key_enc) return fail("Add your Claude or ChatGPT API key in Settings.");
  const ai = createAiClient(p.ai_provider, await decrypt(p.ai_key_enc, key), p.ai_model);

  // Email and today's calendar from every connected mailbox.
  const since = p.last_mail_check ? new Date(p.last_mail_check) : new Date(startedAt.getTime() - 86_400_000);
  const emails: Email[] = [];
  const calendarToday: CalendarItem[] = [];
  const { data: boxes } = await db.from("mail_connections").select("*").eq("user_id", p.user_id);
  for (const box of boxes ?? []) {
    const provider = box.provider as MailProvider;
    try {
      const fresh = await refreshAccess(provider, oauthApp(provider), await decrypt(box.refresh_token_enc, key));
      if (fresh.refreshToken) {
        await db
          .from("mail_connections")
          .update({ refresh_token_enc: await encrypt(fresh.refreshToken, key) })
          .match({ user_id: p.user_id, provider, email: box.email });
      }
      emails.push(...(await fetchMail(provider, fresh.accessToken, since)));
      calendarToday.push(...(await fetchTodayEvents(provider, fresh.accessToken, p.time_zone, today)));
    } catch (err) {
      console.error(`mailbox ${provider}`, err);
      mailboxFailed = true;
      warnings.push(
        err instanceof MailAuthError
          ? `Reconnect ${box.email} in Settings: access stopped working.`
          : `Couldn't read ${box.email} this time.`,
      );
    }
  }
  calendarToday.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  // Blackboard calendar feed.
  let feed: string | null = null;
  if (p.blackboard_feed_enc) {
    try {
      const url = checkFeedUrl(await decrypt(p.blackboard_feed_enc, key));
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      feed = await res.text();
    } catch (err) {
      console.error("blackboard feed", err);
      warnings.push("Couldn't read the Blackboard calendar link. Check it in Settings.");
    }
  }

  const { data: storedRows } = await db
    .from("deadlines")
    .select("course, task, action, due_date, due_time, source, source_ref")
    .eq("user_id", p.user_id)
    .gte("due_date", today);
  const { data: keyRows } = await db.from("deadlines").select("dedupe_key").eq("user_id", p.user_id);

  let result;
  try {
    result = await runDailyCheck({
      ai,
      ctx: { timeZone: p.time_zone, today, courses: p.courses, university: UNIVERSITY },
      emails,
      blackboardFeed: feed,
      calendarToday,
      stored: (storedRows ?? []).map(toDeadline),
      knownKeys: new Set((keyRows ?? []).map((r) => r.dedupe_key as string)),
      pendingQuestions: p.pending_questions ?? [],
    });
  } catch (err) {
    console.error("ai", err);
    return fail(err instanceof AiKeyError ? `${err.message}. Update it in Settings.` : "The AI step failed. It will try again next hour.");
  }

  if (result.newDeadlines.length) {
    const { error } = await db.from("deadlines").upsert(
      result.newDeadlines.map((d) => ({
        user_id: p.user_id,
        course: d.course,
        task: d.task,
        action: d.action,
        due_date: d.dueDate,
        due_time: d.dueTime,
        source: d.source,
        source_ref: d.sourceRef ?? null,
        dedupe_key: d.key,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const b = result.briefing;
  const { error: bErr } = await db.from("briefings").upsert(
    {
      user_id: p.user_id,
      run_date: today,
      headline: b.headline,
      overview: b.overview,
      today: b.today,
      new_since_yesterday: b.newSinceYesterday,
      watch_out: [...b.watchOut, ...warnings],
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,run_date" },
  );
  if (bErr) throw bErr;

  const { error: pErr } = await db
    .from("profiles")
    .update({
      // Only move the email bookmark forward when every mailbox was read.
      last_mail_check: mailboxFailed ? p.last_mail_check : startedAt.toISOString(),
      last_run_date: today,
      last_run_error: warnings.length ? warnings.join(" ") : null,
      pending_questions: result.questions,
    })
    .eq("user_id", p.user_id);
  if (pErr) throw pErr;

  await sendPush(p.expo_push_token, "Uni Assistant", b.headline);
  for (const r of result.reminders) {
    await sendPush(p.expo_push_token, "Due in 3 days", eventName(r));
  }
  return { ok: true, message: b.headline };
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST");
  const db = adminClient();

  // A student pressing "Run now" in the app.
  if (!req.headers.get("x-cron-secret")) {
    const user = await requireUser(req);
    const { data: p, error } = await db.from("profiles").select(PROFILE_COLUMNS).eq("user_id", user.id).single();
    if (error || !p) throw new HttpError(404, "Profile not found");
    return json(await runForStudent(p as Profile));
  }

  // The hourly scheduler.
  if (req.headers.get("x-cron-secret") !== env("CRON_SECRET")) throw new HttpError(401, "Wrong scheduler secret");
  const started = Date.now();
  const { data: profiles, error } = await db.from("profiles").select(PROFILE_COLUMNS).not("ai_key_enc", "is", null);
  if (error) throw error;
  const due = (profiles as Profile[]).filter((p) => {
    const now = localNow(p.time_zone);
    return now.hour >= p.briefing_hour && (p.last_run_date ?? "") < now.date;
  });
  let done = 0;
  for (const p of due) {
    if (Date.now() - started > TIME_BUDGET_MS) break; // the rest run next hour
    try {
      await runForStudent(p);
    } catch (err) {
      console.error(`student ${p.user_id}`, err);
    }
    done++;
  }
  return json({ due: due.length, done });
});
