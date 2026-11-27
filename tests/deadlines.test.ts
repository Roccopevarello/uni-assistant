import { describe, expect, it } from "vitest";
import {
  addDays, dayLabel, dedupeKey, eventDate, eventName, localNow, reminderDate,
} from "../supabase/functions/_shared/deadlines.ts";

describe("deadline rules", () => {
  const d = { course: "Econometrics", task: "Problem Set 3", action: "submit", dueDate: "2026-12-05", dueTime: "23:59" };

  it("names events like the Mac check did", () => {
    expect(eventName(d)).toBe("Econometrics — Problem Set 3: submit on Sat 05/12 by 23:59");
    expect(eventName({ ...d, dueTime: null })).toBe("Econometrics — Problem Set 3: submit on Sat 05/12");
  });

  it("places the event 2 days before and the reminder 3 days before", () => {
    expect(eventDate(d)).toBe("2026-12-03");
    expect(reminderDate(d)).toBe("2026-12-02");
    expect(eventDate({ dueDate: "2027-01-01" })).toBe("2026-12-30");
  });

  it("handles month and leap-year edges", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(dayLabel("2026-11-25")).toBe("Wed 25/11");
  });

  it("matches the same deadline from email and Blackboard", () => {
    expect(dedupeKey({ course: "Econometrics", task: "Problem Set 3", dueDate: "2026-12-05" })).toBe(
      dedupeKey({ course: " econometrics ", task: "problem set  3!", dueDate: "2026-12-05" }),
    );
  });

  it("reads the local date and hour in Madrid", () => {
    expect(localNow("Europe/Madrid", new Date("2026-11-25T23:30:00Z"))).toEqual({ date: "2026-11-26", hour: 0, time: "00:30" });
  });

  it("rejects bad dates", () => {
    expect(() => addDays("2026-13-40", 1)).toThrow();
  });
});
