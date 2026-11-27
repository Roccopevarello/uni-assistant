// Microsoft or Google sends the student back here after they approve read access.
import { encrypt } from "../_shared/crypto.ts";
import { exchangeCode, type MailProvider } from "../_shared/mail.ts";
import { adminClient, encryptionKey, oauthApp, serve } from "../_shared/server.ts";

function back(to: string, params: Record<string, string>): Response {
  const url = new URL(to);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const db = adminClient();
  const { data: row } = await db.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!row) return new Response("This sign-in link has expired. Go back to the app and try again.", { status: 400 });
  await db.from("oauth_states").delete().eq("state", state);

  const provider = row.provider as MailProvider;
  const code = url.searchParams.get("code");
  if (!code || Date.now() - Date.parse(row.created_at) > 3_600_000) {
    return back(row.return_to, { mailbox_error: url.searchParams.get("error_description") ?? "Sign-in was cancelled" });
  }
  try {
    const tokens = await exchangeCode(provider, oauthApp(provider), code, row.verifier);
    const { error } = await db.from("mail_connections").upsert({
      user_id: row.user_id,
      provider,
      email: tokens.email,
      refresh_token_enc: await encrypt(tokens.refreshToken, encryptionKey()),
      connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    return back(row.return_to, { mailbox_connected: tokens.email });
  } catch (err) {
    console.error(err);
    return back(row.return_to, { mailbox_error: "Could not connect that mailbox. Your university may need to approve the app." });
  }
});
