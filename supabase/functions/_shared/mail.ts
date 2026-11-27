// Read-only access to the student's mailbox and calendar through official
// sign-in (Microsoft 365 / Outlook or Google). The app never sends email,
// never deletes anything and never invites anyone: it only asks for read scopes.
import type { CalendarItem } from "./briefing.ts";
import type { Email } from "./triage.ts";

export type MailProvider = "microsoft" | "google";

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const CONFIG = {
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email offline_access User.Read Mail.Read Calendars.Read",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope:
      "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
  },
} as const;

/** Most emails read in one run per mailbox. */
export const MAX_EMAILS_PER_RUN = 100;

export class MailAuthError extends Error {}

export function authorizeUrl(
  provider: MailProvider,
  app: OAuthApp,
  state: string,
  codeChallenge: string,
): string {
  const p = new URLSearchParams({
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: app.redirectUri,
    scope: CONFIG[provider].scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (provider === "google") {
    p.set("access_type", "offline");
    p.set("prompt", "consent");
  } else {
    p.set("prompt", "select_account");
  }
  return `${CONFIG[provider].authorize}?${p}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(provider: MailProvider, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(CONFIG[provider].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new MailAuthError(`${provider} sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json;
}

export async function exchangeCode(
  provider: MailProvider,
  app: OAuthApp,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken: string; email: string }> {
  const t = await tokenRequest(provider, {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: app.redirectUri,
    code_verifier: verifier,
  });
  if (!t.refresh_token) throw new MailAuthError(`${provider} did not return a refresh token`);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, email: await accountEmail(provider, t.access_token) };
}

/** Gets a fresh access token. Microsoft may also hand back a new refresh token, which must be saved. */
export async function refreshAccess(
  provider: MailProvider,
  app: OAuthApp,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const body: Record<string, string> = {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  if (provider === "microsoft") body.scope = CONFIG.microsoft.scope;
  const t = await tokenRequest(provider, body);
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null };
}

async function getJson<T>(url: string, accessToken: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, ...headers } });
  if (res.status === 401 || res.status === 403) throw new MailAuthError(`Mailbox access was refused (${res.status})`);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function accountEmail(provider: MailProvider, accessToken: string): Promise<string> {
  if (provider === "microsoft") {
    const me = await getJson<{ mail?: string; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me", accessToken);
    return me.mail ?? me.userPrincipalName ?? "";
  }
  const me = await getJson<{ email?: string }>("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
  return me.email ?? "";
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Microsoft 365 / Outlook ----------

/** Graph wants %20 for spaces in OData queries, not "+". */
const odata = (p: URLSearchParams) => p.toString().replace(/\+/g, "%20");

interface GraphMessage {
  id: string;
  subject: string | null;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType: string; content: string };
}

async function outlookMail(accessToken: string, since: Date): Promise<Email[]> {
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: "50",
    $select: "id,subject,from,receivedDateTime,body",
  });
  let url: string | null = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${odata(params)}`;
  const out: Email[] = [];
  while (url && out.length < MAX_EMAILS_PER_RUN) {
    const page: { value: GraphMessage[]; "@odata.nextLink"?: string } = await getJson(url, accessToken, {
      prefer: 'outlook.body-content-type="text"',
    });
    for (const m of page.value) {
      const from = m.from?.emailAddress;
      out.push({
        id: `ms:${m.id}`,
        from: from?.name && from.address ? `${from.name} <${from.address}>` : (from?.address ?? "unknown"),
        subject: m.subject ?? "(no subject)",
        receivedAt: m.receivedDateTime,
        body: m.body?.contentType === "html" ? htmlToText(m.body.content) : (m.body?.content ?? ""),
      });
    }
    url = page["@odata.nextLink"] ?? null;
  }
  return out.slice(0, MAX_EMAILS_PER_RUN);
}

interface GraphEvent {
  subject: string;
  isAllDay: boolean;
  isCancelled?: boolean;
  start: { dateTime: string };
  end: { dateTime: string };
}

async function outlookToday(accessToken: string, timeZone: string, today: string): Promise<CalendarItem[]> {
  // Ask a wide UTC window and keep what starts on the local day; Graph returns local times.
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${today}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "subject,isAllDay,isCancelled,start,end",
    $orderby: "start/dateTime",
    $top: "50",
  });
  const res = await getJson<{ value: GraphEvent[] }>(
    `https://graph.microsoft.com/v1.0/me/calendarView?${odata(params)}`,
    accessToken,
    { prefer: `outlook.timezone="${timeZone}"` },
  );
  return res.value
    .filter((e) => !e.isCancelled)
    .filter((e) =>
      e.isAllDay
        ? e.start.dateTime.slice(0, 10) <= today && e.end.dateTime.slice(0, 10) > today
        : e.start.dateTime.slice(0, 10) === today,
    )
    .map((e) => ({
      title: e.subject,
      start: e.isAllDay ? null : e.start.dateTime.slice(11, 16),
      end: e.isAllDay ? null : e.end.dateTime.slice(11, 16),
    }));
}

// ---------- Google ----------

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function b64urlDecode(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function gmailBody(part: GmailPart): string {
  const find = (p: GmailPart, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return b64urlDecode(p.body.data);
    for (const child of p.parts ?? []) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  };
  const plain = find(part, "text/plain");
  if (plain) return plain.trim();
  const html = find(part, "text/html");
  return html ? htmlToText(html) : "";
}

async function gmailMail(accessToken: string, since: Date): Promise<Email[]> {
  const q = `in:inbox after:${Math.floor(since.getTime() / 1000)}`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ q, maxResults: "50" });
    if (pageToken) p.set("pageToken", pageToken);
    const page = await getJson<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${p}`,
      accessToken,
    );
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_EMAILS_PER_RUN);

  const out: Email[] = [];
  for (const id of ids.slice(0, MAX_EMAILS_PER_RUN)) {
    const m = await getJson<{ id: string; internalDate: string; payload: GmailPart & { headers?: { name: string; value: string }[] } }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      accessToken,
    );
    const header = (n: string) => m.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value;
    out.push({
      id: `g:${m.id}`,
      from: header("from") ?? "unknown",
      subject: header("subject") ?? "(no subject)",
      receivedAt: new Date(Number(m.internalDate)).toISOString(),
      body: gmailBody(m.payload),
    });
  }
  return out;
}

interface GoogleEvent {
  summary?: string;
  status?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

async function googleToday(accessToken: string, timeZone: string, today: string): Promise<CalendarItem[]> {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${today}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const p = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    timeZone,
    maxResults: "50",
  });
  const res = await getJson<{ items: GoogleEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,
    accessToken,
  );
  return res.items
    .filter((e) => e.status !== "cancelled")
    .filter((e) => {
      if (e.start.date) return e.start.date <= today && (e.end.date ?? e.start.date) > today;
      return e.start.dateTime?.slice(0, 10) === today;
    })
    .map((e) => ({
      title: e.summary ?? "(no title)",
      start: e.start.dateTime ? e.start.dateTime.slice(11, 16) : null,
      end: e.end.dateTime ? e.end.dateTime.slice(11, 16) : null,
    }));
}

export function fetchMail(provider: MailProvider, accessToken: string, since: Date): Promise<Email[]> {
  return provider === "microsoft" ? outlookMail(accessToken, since) : gmailMail(accessToken, since);
}

export function fetchTodayEvents(
  provider: MailProvider,
  accessToken: string,
  timeZone: string,
  today: string,
): Promise<CalendarItem[]> {
  return provider === "microsoft" ? outlookToday(accessToken, timeZone, today) : googleToday(accessToken, timeZone, today);
}
