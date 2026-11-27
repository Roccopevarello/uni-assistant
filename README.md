# Uni Assistant

The daily uni check, as an app for IE students. Every morning it reads your
email and your Blackboard calendar, adds deadlines to a calendar you subscribe
to, and sends a short briefing to your phone. It runs on the web, iPhone and
Android from one codebase, and the work happens on a server, so your computer
can stay off.

This is **phase 1**: email, Blackboard due dates, the deadline calendar and the
morning briefing. Grades, attendance and submission status (phase 2) need a
Chrome extension and are not built yet.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| `app/` | Expo (React Native + web) | Sign in, today's briefing, deadlines, settings |
| `supabase/migrations/` | Supabase Postgres | Accounts, deadlines, briefings, encrypted secrets |
| `supabase/functions/daily-check` | Supabase edge function | The daily check, run every hour by the scheduler, once a day per student |
| `supabase/functions/save-settings` | edge function | Checks and stores the AI key, Blackboard link, courses, time zone |
| `supabase/functions/oauth-start`, `oauth-callback` | edge functions | Read-only sign-in to Outlook (IE account) or Gmail |
| `supabase/functions/calendar` | edge function | The private "IE Deadlines" calendar link |
| `supabase/functions/_shared/` | shared code | Deadline rules, Blackboard feed, AI calls, briefing (unit tested) |

Rules carried over from the Mac version: a deadline becomes an all-day event 2
days before it is due, with an alarm at its start, and a reminder goes out 3
days before. Event names follow `[Course] — [Task]: [action] on [Day DD/MM]`,
plus `by HH:MM` when there is a time. Unclear dates are not added; they are
asked about in the briefing. The app never sends email, never deletes anything
and never invites anyone: it only asks for read access.

**AI:** each student pastes their own Anthropic (Claude) or OpenAI (ChatGPT) API
key. Claude subscriptions can't be used by outside apps, and "Sign in with
ChatGPT" needs OpenAI's approval, so API keys are the route that works today.
Keys are checked when saved and stored encrypted. The default models are
`claude-opus-5-5` and `gpt-5`; a student can pick another model in Settings.

## Setup

You need a [Supabase](https://supabase.com) project, a Microsoft app
registration (for IE / Outlook email) and, optionally, a Google OAuth client
(for Gmail).

### 1. Server

```bash
npm install --legacy-peer-deps
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase functions deploy
```

Set the function secrets (Supabase dashboard > Edge Functions > Secrets, or
`npx supabase secrets set NAME=value`):

| Secret | Value |
| --- | --- |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Keep a copy: losing it means everyone re-enters their keys. |
| `CRON_SECRET` | Any long random string, e.g. `openssl rand -hex 32` |
| `APP_RETURN_URLS` | Where mailbox sign-in may send people back, comma-separated, e.g. `https://your-web-app.example,uniassistant://` |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | From the Microsoft app registration (below) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From the Google OAuth client (optional) |
| `BLACKBOARD_FEED_HOSTS` | Optional. Defaults to `blackboard.ie.edu` |
| `UNIVERSITY_NAME` | Optional. Defaults to `IE University` |

Then open `supabase/setup/schedule.sql`, fill in the two placeholders and run it
in the SQL editor. It calls the daily check every hour.

**Sign-in emails:** the app signs in with a 6-digit code, which works the same
on web and phone. Supabase's built-in email sender only reaches your own team,
sends a couple of emails an hour, and on the free plan its templates can't be
changed. So connect a real sender first (Authentication > SMTP Settings, e.g. a
free [Resend](https://resend.com) account), then in Authentication > Email
Templates put `{{ .Token }}` in both the Magic Link and Confirm signup
templates, and set the code length to 6.

### 2. Microsoft (IE / Outlook email)

1. In the [Azure portal](https://portal.azure.com), App registrations > New
   registration. Supported accounts: "Accounts in any organizational directory
   and personal Microsoft accounts".
2. Redirect URI (Web): `https://<project-ref>.supabase.co/functions/v1/oauth-callback`.
3. API permissions (delegated): `User.Read`, `Mail.Read`, `Calendars.Read`,
   `offline_access`.
4. Certificates & secrets > New client secret.

IE's IT may need to approve the app before students can connect their IE
mailbox ("admin consent"). Try connecting your own account first.

### 3. Google (Gmail, optional)

Create an OAuth client (Web application) with the same redirect URI and the
scopes `gmail.readonly` and `calendar.readonly`. Gmail read access is a
restricted scope: in testing mode only listed test users can connect, and
opening it to everyone needs Google's verification.

### 4. App

```bash
cd app
cp .env.example .env   # fill in the Supabase URL and anon key
npm install --legacy-peer-deps
npx expo start         # press w for web, or scan the QR code with Expo Go
```

Phone notifications need a development or store build: run `npx eas init`, put
the project id in `EXPO_PUBLIC_EAS_PROJECT_ID`, then `npx eas build`.

### 5. Blackboard

Each student opens Blackboard > Calendar > settings, copies the calendar feed
link, and pastes it in the app's Settings. If IE has the feed turned off, due
dates still come in through email, and the phase 2 Chrome extension will read
them from Blackboard directly.

## Development

```bash
npm test                 # unit tests for the shared logic
npm run typecheck        # shared code (Node)
cd supabase/functions && npx deno check --config deno.json */index.ts
cd app && npx tsc --noEmit
```

## Known limits

- Each scheduler call handles students for up to 5 minutes; anyone left over is
  handled the next hour. Fine for a class, not yet for thousands of students.
- Calendar apps refresh subscribed calendars on their own schedule (Apple: as
  often as every 15 minutes to every few hours), and some drop alarms from
  subscribed calendars. The 3-day reminder also comes as a phone notification.
- Blackboard times with a named time zone are read as local time; IE's feed
  uses UTC, which is converted correctly.
