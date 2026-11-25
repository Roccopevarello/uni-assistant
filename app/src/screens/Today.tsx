import React, { useState } from "react";
import { Text, View } from "react-native";
import { callFunction } from "../lib/supabase";
import type { BriefingRow, Profile } from "../lib/types";
import { Body, Bullets, Button, Card, Notice, useTheme } from "../ui";

export default function Today({
  profile,
  briefing,
  reload,
  goToSettings,
}: {
  profile: Profile;
  briefing: BriefingRow | null;
  reload: () => Promise<void>;
  goToSettings: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(profile.ai_provider && profile.ai_key_hint);

  async function runNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await callFunction<{ ok: boolean; message: string }>("daily-check", {});
      if (!res.ok) setError(res.message);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <Card title="Let's set you up">
        <Body>Connect your Claude or ChatGPT key, your university email and your Blackboard calendar. Then you'll get a briefing every morning.</Body>
        <Button label="Open settings" onPress={goToSettings} />
      </Card>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {profile.last_run_error ? <Notice text={profile.last_run_error} /> : null}
      {error ? <Notice tone="error" text={error} /> : null}
      {briefing ? (
        <>
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>Briefing for {briefing.run_date}</Text>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: "700" }}>{briefing.headline}</Text>
          </View>
          {briefing.overview.length ? (
            <Card>
              <Bullets items={briefing.overview} />
            </Card>
          ) : null}
          <Card title="Today">
            <Bullets items={briefing.today} empty="Nothing scheduled." />
          </Card>
          <Card title="New since yesterday">
            <Bullets items={briefing.new_since_yesterday} empty="Nothing new." />
          </Card>
          <Card title="Watch out">
            <Bullets items={briefing.watch_out} empty="All clear." />
          </Card>
        </>
      ) : (
        <Card title="No briefing yet">
          <Body>Your first briefing arrives at {String(profile.briefing_hour).padStart(2, "0")}:00. You can also run the check now.</Body>
        </Card>
      )}
      {profile.pending_questions.length ? (
        <Card title="Needs your answer">
          <Body muted>These dates weren't clear, so they weren't added to your calendar.</Body>
          <Bullets items={profile.pending_questions} />
        </Card>
      ) : null}
      <Button label="Run the check now" kind="secondary" onPress={runNow} busy={busy} />
    </View>
  );
}
