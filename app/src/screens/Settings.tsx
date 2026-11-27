import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import { deviceTimeZone } from "../lib/dates";
import { callFunction, supabase } from "../lib/supabase";
import type { Mailbox, Profile } from "../lib/types";
import { Body, Button, Card, Field, Notice, Segmented, useTheme } from "../ui";

type Provider = "anthropic" | "openai";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: okText, tone: "ok" });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run };
}

function Result({ msg }: { msg: { text: string; tone: "ok" | "error" } | null }) {
  const t = useTheme();
  if (!msg) return null;
  return msg.tone === "error" ? <Notice tone="error" text={msg.text} /> : <Text style={{ color: t.muted }}>{msg.text}</Text>;
}

function AiSection({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const [provider, setProvider] = useState<Provider | null>(profile.ai_provider);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(profile.ai_model ?? "");
  const a = useAction();
  const saved = profile.ai_key_hint && provider === profile.ai_provider;

  return (
    <Card title="AI account">
      <Body muted>
        The app uses your own API key. Claude subscriptions can't be used by outside apps, so use an API key from
        console.anthropic.com or platform.openai.com. You pay the AI company directly for what the app uses.
      </Body>
      <Segmented
        options={[
          { value: "anthropic", label: "Claude" },
          { value: "openai", label: "ChatGPT" },
        ]}
        value={provider}
        onChange={setProvider}
      />
      <Field
        label={provider === "openai" ? "OpenAI API key" : "Anthropic API key"}
        value={key}
        onChangeText={setKey}
        secureTextEntry
        placeholder={saved ? `Saved (${profile.ai_key_hint}). Paste a new one to replace it.` : "Paste your key"}
      />
      <Field
        label="Model (optional)"
        value={model}
        onChangeText={setModel}
        placeholder={provider === "openai" ? "gpt-5" : "claude-opus-5-5"}
        hint="Leave empty for the default."
      />
      <Button
        label="Check and save"
        busy={a.busy}
        disabled={!provider || (!key && !saved && provider !== profile.ai_provider)}
        onPress={() =>
          a.run(async () => {
            await callFunction("save-settings", { ai_provider: provider, ai_key: key || undefined, ai_model: model });
            setKey("");
            await reload();
          }, "Saved. The key works.")
        }
      />
      <Result msg={a.msg} />
    </Card>
  );
}

function MailSection({ mailboxes, reload }: { mailboxes: Mailbox[]; reload: () => Promise<void> }) {
  const a = useAction();

  async function connect(provider: "microsoft" | "google") {
    const returnTo = Platform.OS === "web" ? `${window.location.origin}/` : Linking.createURL("mailbox");
    const { url } = await callFunction<{ url: string }>("oauth-start", { provider, return_to: returnTo });
    if (Platform.OS === "web") {
      window.location.href = url;
      return;
    }
    const res = await WebBrowser.openAuthSessionAsync(url, returnTo);
    if (res.type === "success") {
      const { queryParams } = Linking.parse(res.url);
      if (queryParams?.mailbox_error) throw new Error(String(queryParams.mailbox_error));
    }
    await reload();
  }

  return (
    <Card title="Email and calendar">
      <Body muted>Read-only access. The app never sends, deletes or changes anything in your mailbox.</Body>
      {mailboxes.map((m) => (
        <View key={`${m.provider}:${m.email}`} style={{ gap: 8 }}>
          <Body>
            {m.provider === "microsoft" ? "Outlook" : "Gmail"}: {m.email}
          </Body>
          <Button
            label="Disconnect"
            kind="danger"
            onPress={() =>
              a.run(async () => {
                await callFunction("save-settings", { disconnect_mailbox: { provider: m.provider, email: m.email } });
                await reload();
              }, "Disconnected.")
            }
          />
        </View>
      ))}
      <Button label="Connect IE / Outlook email" onPress={() => a.run(() => connect("microsoft"), "Mailbox connected.")} busy={a.busy} />
      <Button label="Connect Gmail" kind="secondary" onPress={() => a.run(() => connect("google"), "Mailbox connected.")} />
      <Result msg={a.msg} />
    </Card>
  );
}

function BlackboardSection({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [courses, setCourses] = useState(profile.courses.join(", "));
  const a = useAction();
  return (
    <Card title="Blackboard">
      <Body muted>
        In Blackboard, open Calendar, then the settings, and copy the calendar feed link. Paste it here so due dates
        are picked up automatically.
      </Body>
      <Field
        label="Blackboard calendar link"
        value={url}
        onChangeText={setUrl}
        placeholder={profile.has_blackboard_feed ? "Saved. Paste a new link to replace it." : "https://blackboard.ie.edu/…"}
      />
      <Field
        label="Your courses"
        value={courses}
        onChangeText={setCourses}
        autoCapitalize="words"
        placeholder="Econometrics, Public Economics, …"
        hint="Comma-separated. Helps match emails and Blackboard items to the right course."
      />
      <Button
        label="Save"
        busy={a.busy}
        onPress={() =>
          a.run(async () => {
            await callFunction("save-settings", {
              blackboard_feed_url: url ? url : undefined,
              courses: courses.split(",").map((c) => c.trim()).filter(Boolean),
            });
            setUrl("");
            await reload();
          }, "Saved.")
        }
      />
      <Result msg={a.msg} />
    </Card>
  );
}

function ScheduleSection({ profile, reload }: { profile: Profile; reload: () => Promise<void> }) {
  const [hour, setHour] = useState(String(profile.briefing_hour));
  const [tz, setTz] = useState(profile.time_zone);
  const a = useAction();
  const device = deviceTimeZone();
  return (
    <Card title="Morning briefing">
      <Field label="Briefing time (hour, 0 to 23)" value={hour} onChangeText={setHour} keyboardType="number-pad" />
      <Field
        label="Time zone"
        value={tz}
        onChangeText={setTz}
        hint={device !== tz ? `This device is set to ${device}.` : undefined}
      />
      <Button
        label="Save"
        busy={a.busy}
        onPress={() =>
          a.run(async () => {
            await callFunction("save-settings", { briefing_hour: Number(hour), time_zone: tz.trim() });
            await reload();
          }, "Saved.")
        }
      />
      <Result msg={a.msg} />
    </Card>
  );
}

function CalendarSection({ profile }: { profile: Profile }) {
  const a = useAction();
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  const https = `${base}/functions/v1/calendar?token=${profile.calendar_token}`;
  const webcal = https.replace(/^https:/, "webcal:");
  return (
    <Card title="Deadline calendar">
      <Body muted>
        Subscribe once and your deadlines appear in Apple, Google or Outlook Calendar: each one as an all-day event two
        days before it's due. Keep this link private.
      </Body>
      <Button label="Copy calendar link" busy={a.busy} onPress={() => a.run(() => Clipboard.setStringAsync(https), "Link copied.")} />
      {Platform.OS !== "web" ? (
        <Button label="Add to this phone's calendar" kind="secondary" onPress={() => Linking.openURL(webcal)} />
      ) : null}
      <Result msg={a.msg} />
    </Card>
  );
}

function NotificationsSection() {
  const a = useAction();
  if (Platform.OS === "web") {
    return (
      <Card title="Notifications">
        <Body muted>Install the app on your phone to get the briefing as a notification.</Body>
      </Card>
    );
  }
  return (
    <Card title="Notifications">
      <Button
        label="Turn on morning notifications"
        busy={a.busy}
        onPress={() =>
          a.run(async () => {
            if (!Device.isDevice) throw new Error("Notifications need a real phone, not a simulator.");
            const { status } = await Notifications.requestPermissionsAsync();
            if (status !== "granted") throw new Error("Notifications are off for this app in your phone's settings.");
            const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
            if (!projectId) throw new Error("This build is missing its project id. See the README.");
            const token = await Notifications.getExpoPushTokenAsync({ projectId });
            await callFunction("save-settings", { expo_push_token: token.data });
          }, "Notifications are on.")
        }
      />
      <Result msg={a.msg} />
    </Card>
  );
}

export default function Settings({
  profile,
  mailboxes,
  reload,
}: {
  profile: Profile;
  mailboxes: Mailbox[];
  reload: () => Promise<void>;
}) {
  return (
    <View style={{ gap: 14 }}>
      <AiSection profile={profile} reload={reload} />
      <MailSection mailboxes={mailboxes} reload={reload} />
      <BlackboardSection profile={profile} reload={reload} />
      <ScheduleSection profile={profile} reload={reload} />
      <CalendarSection profile={profile} />
      <NotificationsSection />
      <Button label="Sign out" kind="secondary" onPress={() => supabase.auth.signOut()} />
    </View>
  );
}
