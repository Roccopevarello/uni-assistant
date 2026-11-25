// The private "IE Deadlines" calendar link students subscribe to on any device.
import { buildCalendar } from "../_shared/ics.ts";
import { addDays, localNow } from "../_shared/deadlines.ts";
import { adminClient, serve } from "../_shared/server.ts";

serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const db = adminClient();
  const { data: profile } = await db.from("profiles").select("user_id, time_zone").eq("calendar_token", token).maybeSingle();
  if (!profile) return new Response("Not found", { status: 404 });
  const since = addDays(localNow(profile.time_zone).date, -60);
  const { data, error } = await db
    .from("deadlines")
    .select("id, course, task, action, due_date, due_time, source, source_ref")
    .eq("user_id", profile.user_id)
    .gte("due_date", since)
    .order("due_date");
  if (error) throw error;
  const ics = buildCalendar(
    (data ?? []).map((d) => ({
      id: d.id,
      course: d.course,
      task: d.task,
      action: d.action,
      dueDate: d.due_date,
      dueTime: d.due_time,
      source: d.source,
      sourceRef: d.source_ref,
    })),
  );
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900" },
  });
});
