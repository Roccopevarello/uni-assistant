import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, fetchMail, fetchTodayEvents, gmailBody, htmlToText } from "../supabase/functions/_shared/mail.ts";

const app = { clientId: "cid", clientSecret: "secret", redirectUri: "https://x.supabase.co/functions/v1/oauth-callback" };
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_");

afterEach(() => vi.unstubAllGlobals());

function stubFetch(routes: Record<string, unknown>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  return seen;
}

describe("mailbox sign-in", () => {
  it("asks for read-only scopes with PKCE", () => {
    const ms = new URL(authorizeUrl("microsoft", app, "st", "ch"));
    expect(ms.searchParams.get("scope")).toBe("openid email offline_access User.Read Mail.Read Calendars.Read");
    expect(ms.searchParams.get("code_challenge_method")).toBe("S256");
    const g = new URL(authorizeUrl("google", app, "st", "ch"));
    expect(g.searchParams.get("scope")).toContain("gmail.readonly");
    expect(g.searchParams.get("access_type")).toBe("offline");
    for (const u of [ms, g]) expect(u.searchParams.get("scope")).not.toMatch(/send|write|modify|ReadWrite/i);
  });
});

describe("reading mail", () => {
  it("turns HTML into plain text", () => {
    expect(htmlToText("<p>Hi&nbsp;Rocco</p><style>x{}</style><div>Due <b>Friday</b> &amp; late</div>")).toBe("Hi Rocco\nDue Friday & late");
  });

  it("prefers the plain-text part of a Gmail message", () => {
    const body = gmailBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
        { mimeType: "text/plain", body: { data: b64url("plain text") } },
      ],
    });
    expect(body).toBe("plain text");
  });

  it("follows Outlook pages and labels the sender", async () => {
    const seen = stubFetch({
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?": {
        value: [{ id: "a", subject: "PS3", receivedDateTime: "2026-11-24T10:00:00Z", from: { emailAddress: { name: "Prof", address: "p@ie.edu" } }, body: { contentType: "text", content: "Due Fri" } }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page",
      },
      "https://graph.microsoft.com/v1.0/next-page": {
        value: [{ id: "b", subject: null, receivedDateTime: "2026-11-24T09:00:00Z", body: { contentType: "html", content: "<p>Hi</p>" } }],
      },
    });
    const mail = await fetchMail("microsoft", "tok", new Date("2026-11-24T00:00:00Z"));
    expect(mail).toEqual([
      { id: "ms:a", from: "Prof <p@ie.edu>", subject: "PS3", receivedAt: "2026-11-24T10:00:00Z", body: "Due Fri" },
      { id: "ms:b", from: "unknown", subject: "(no subject)", receivedAt: "2026-11-24T09:00:00Z", body: "Hi" },
    ]);
    expect(decodeURIComponent(seen[0].url)).toContain("receivedDateTime ge 2026-11-24T00:00:00.000Z");
    expect(seen[0].headers.authorization).toBe("Bearer tok");
  });

  it("keeps only today's events from Google, all-day included", async () => {
    stubFetch({
      "https://www.googleapis.com/calendar/v3/calendars/primary/events": {
        items: [
          { summary: "Econometrics", start: { dateTime: "2026-11-25T09:00:00+01:00" }, end: { dateTime: "2026-11-25T10:30:00+01:00" } },
          { summary: "Yesterday", start: { dateTime: "2026-11-24T09:00:00+01:00" }, end: { dateTime: "2026-11-24T10:00:00+01:00" } },
          { summary: "Exam week", start: { date: "2026-11-23" }, end: { date: "2026-11-28" } },
          { summary: "Cancelled", status: "cancelled", start: { dateTime: "2026-11-25T12:00:00+01:00" }, end: { dateTime: "2026-11-25T13:00:00+01:00" } },
        ],
      },
    });
    expect(await fetchTodayEvents("google", "tok", "Europe/Madrid", "2026-11-25")).toEqual([
      { title: "Econometrics", start: "09:00", end: "10:30" },
      { title: "Exam week", start: null, end: null },
    ]);
  });

  it("reports a refused mailbox as a sign-in problem", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    await expect(fetchMail("google", "tok", new Date())).rejects.toThrow(/refused/);
  });
});
