// Helpers used by every edge function (Deno runtime).
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { MailProvider, OAuthApp } from "./mail.ts";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing server setting ${name}`);
  return v;
}

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps a handler with CORS preflight and error-to-JSON handling. */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  });
}

let admin: SupabaseClient | null = null;
/** Server-side client that bypasses row level security. Never sent to the app. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in first");
  return data.user;
}

export function encryptionKey(): string {
  return env("ENCRYPTION_KEY");
}

export function oauthApp(provider: MailProvider): OAuthApp {
  const prefix = provider === "microsoft" ? "MICROSOFT" : "GOOGLE";
  return {
    clientId: env(`${prefix}_CLIENT_ID`),
    clientSecret: env(`${prefix}_CLIENT_SECRET`),
    redirectUri: `${env("SUPABASE_URL")}/functions/v1/oauth-callback`,
  };
}

/** Where the app may be sent back to after mailbox sign-in. Comma-separated in APP_RETURN_URLS. */
export function allowedReturn(url: string | null | undefined): string {
  const allowed = env("APP_RETURN_URLS").split(",").map((s) => s.trim()).filter(Boolean);
  if (url && allowed.some((a) => url === a || url.startsWith(a.endsWith("/") ? a : `${a}/`) || url.startsWith(`${a}?`))) {
    return url;
  }
  return allowed[0];
}

/** Sends a phone notification through Expo's push service. Failures are logged, not thrown. */
export async function sendPush(to: string | null, title: string, body: string): Promise<void> {
  if (!to) return;
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to, title, body, sound: "default" }),
    });
    if (!res.ok) console.error("push failed", res.status, await res.text());
  } catch (err) {
    console.error("push failed", err);
  }
}

/**
 * Only calendar links on the university's Blackboard are fetched, so the
 * server can't be pointed at arbitrary addresses. BLACKBOARD_FEED_HOSTS is a
 * comma-separated list, default blackboard.ie.edu.
 */
export function checkFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcal:/i, "https:"));
  } catch {
    throw new HttpError(400, "That doesn't look like a link");
  }
  const hosts = (Deno.env.get("BLACKBOARD_FEED_HOSTS") ?? "blackboard.ie.edu").split(",").map((h) => h.trim().toLowerCase());
  if (url.protocol !== "https:" || !hosts.includes(url.hostname.toLowerCase())) {
    throw new HttpError(400, `Use the calendar link from Blackboard (${hosts.join(", ")})`);
  }
  return url;
}
