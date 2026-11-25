// Saves the student's settings. Secrets are checked, then encrypted before storage.
import { verifyKey, AiKeyError, type AiProvider } from "../_shared/ai.ts";
import { encrypt } from "../_shared/crypto.ts";
import { parseFeed } from "../_shared/ics.ts";
import { adminClient, checkFeedUrl, encryptionKey, HttpError, json, requireUser, serve } from "../_shared/server.ts";

interface Body {
  ai_provider?: AiProvider;
  ai_key?: string;
  ai_model?: string | null;
  blackboard_feed_url?: string | null;
  time_zone?: string;
  briefing_hour?: number;
  courses?: string[];
  expo_push_token?: string | null;
  disconnect_mailbox?: { provider: string; email: string };
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST");
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const update: Record<string, unknown> = {};
  const db = adminClient();

  if (body.ai_provider !== undefined) {
    if (body.ai_provider !== "anthropic" && body.ai_provider !== "openai") throw new HttpError(400, "Pick Claude or ChatGPT");
    update.ai_provider = body.ai_provider;
  }
  if (body.ai_key) {
    const provider = (body.ai_provider ??
      (await db.from("profiles").select("ai_provider").eq("user_id", user.id).single()).data?.ai_provider) as AiProvider | null;
    if (!provider) throw new HttpError(400, "Pick Claude or ChatGPT first");
    const key = body.ai_key.trim();
    try {
      await verifyKey(provider, key);
    } catch (err) {
      if (err instanceof AiKeyError) throw new HttpError(400, err.message);
      throw new HttpError(502, "Could not reach the AI service to check the key. Try again.");
    }
    update.ai_key_enc = await encrypt(key, encryptionKey());
    update.ai_key_hint = `…${key.slice(-4)}`;
  }
  if (body.ai_model !== undefined) update.ai_model = body.ai_model?.trim() || null;

  if (body.blackboard_feed_url !== undefined) {
    const url = body.blackboard_feed_url?.trim();
    if (!url) {
      update.blackboard_feed_enc = null;
    } else {
      const parsed = checkFeedUrl(url);
      const res = await fetch(parsed, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
      const text = res?.ok ? await res.text() : "";
      if (!text.includes("BEGIN:VCALENDAR")) throw new HttpError(400, "That link didn't return a calendar. Copy the calendar feed link from Blackboard.");
      parseFeed(text, "UTC");
      update.blackboard_feed_enc = await encrypt(parsed.toString(), encryptionKey());
    }
  }
  if (body.time_zone !== undefined) {
    if (!validTimeZone(body.time_zone)) throw new HttpError(400, "Unknown time zone");
    update.time_zone = body.time_zone;
  }
  if (body.briefing_hour !== undefined) {
    if (!Number.isInteger(body.briefing_hour) || body.briefing_hour < 0 || body.briefing_hour > 23) {
      throw new HttpError(400, "Briefing hour must be 0 to 23");
    }
    update.briefing_hour = body.briefing_hour;
  }
  if (body.courses !== undefined) {
    update.courses = body.courses.map((c) => String(c).trim()).filter(Boolean).slice(0, 30);
  }
  if (body.expo_push_token !== undefined) update.expo_push_token = body.expo_push_token || null;

  if (body.disconnect_mailbox) {
    const { error } = await db
      .from("mail_connections")
      .delete()
      .match({ user_id: user.id, provider: body.disconnect_mailbox.provider, email: body.disconnect_mailbox.email });
    if (error) throw error;
  }

  if (Object.keys(update).length) {
    const { error } = await db.from("profiles").update(update).eq("user_id", user.id);
    if (error) throw error;
  }
  return json({ ok: true });
});
