// Starts mailbox sign-in with Microsoft (Outlook / IE account) or Google.
import { randomToken, sha256b64url } from "../_shared/crypto.ts";
import { authorizeUrl, type MailProvider } from "../_shared/mail.ts";
import { adminClient, allowedReturn, HttpError, json, oauthApp, requireUser, serve } from "../_shared/server.ts";

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST");
  const user = await requireUser(req);
  const { provider, return_to } = (await req.json()) as { provider: MailProvider; return_to?: string };
  if (provider !== "microsoft" && provider !== "google") throw new HttpError(400, "Unknown email provider");

  const state = randomToken();
  const verifier = randomToken(48);
  const db = adminClient();
  // Clear abandoned attempts older than an hour.
  await db.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3_600_000).toISOString());
  const { error } = await db.from("oauth_states").insert({
    state,
    user_id: user.id,
    provider,
    verifier,
    return_to: allowedReturn(return_to),
  });
  if (error) throw error;
  return json({ url: authorizeUrl(provider, oauthApp(provider), state, await sha256b64url(verifier)) });
});
