import { describe, expect, it } from "vitest";
import { buildCalendar, parseFeed } from "../supabase/functions/_shared/ics.ts";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:bb-123",
  "DTSTART:20261204T225900Z",
  "DTEND:20261204T225900Z",
  "SUMMARY:Problem Set 3 due",
  "CATEGORIES:Econometrics",
  "DESCRIPTION:Upload your answers\\, as PDF.\\nLate work",
  "  is not accepted.",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:bb-124",
  "DTSTART;VALUE=DATE:20261210",
  "SUMMARY:Midterm",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("Blackboard feed", () => {
  it("reads events and converts UTC to the student's time zone", () => {
    const events = parseFeed(FEED, "Europe/Madrid");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ uid: "bb-123", summary: "Problem Set 3 due", date: "2026-12-04", time: "23:59", categories: ["Econometrics"] });
    expect(events[0].description).toBe("Upload your answers, as PDF.\nLate work is not accepted.");
    expect(events[1]).toMatchObject({ uid: "bb-124", date: "2026-12-10", time: null });
  });

  it("crosses midnight when converting", () => {
    const [e] = parseFeed(FEED.replace("20261204T225900Z", "20261204T233000Z"), "Europe/Madrid");
    expect(e).toMatchObject({ date: "2026-12-05", time: "00:30" });
  });
});

describe("deadline calendar", () => {
  it("writes all-day events 2 days early with an alarm at the start", () => {
    const ics = buildCalendar(
      [{ id: "d1", course: "Econometrics", task: "Problem Set 3", action: "submit", dueDate: "2026-12-05", dueTime: "23:59", source: "blackboard" }],
      { now: new Date("2026-11-25T08:00:00Z") },
    );
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261203");
    expect(unfolded).toContain("DTEND;VALUE=DATE:20261204");
    expect(unfolded).toContain("SUMMARY:Econometrics — Problem Set 3: submit on Sat 05/12 by 23:59");
    expect(unfolded).toContain("TRIGGER;RELATED=START:PT0S");
    expect(unfolded).toContain("X-WR-CALNAME:IE Deadlines");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("round-trips through its own parser", () => {
    const ics = buildCalendar([{ id: "x", course: "A, B", task: "T; 1", action: "submit", dueDate: "2026-12-10", dueTime: null, source: "email" }]);
    const [e] = parseFeed(ics, "Europe/Madrid");
    expect(e.summary).toBe("A, B — T; 1: submit on Thu 10/12");
    expect(e.date).toBe("2026-12-08");
  });
});
