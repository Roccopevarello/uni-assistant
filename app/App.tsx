import type { Session } from "@supabase/supabase-js";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { configured, supabase } from "./src/lib/supabase";
import { PROFILE_COLUMNS, type BriefingRow, type DeadlineRow, type Mailbox, type Profile } from "./src/lib/types";
import Deadlines from "./src/screens/Deadlines";
import Settings from "./src/screens/Settings";
import SignIn from "./src/screens/SignIn";
import Today from "./src/screens/Today";
import { Body, Card, Notice, useTheme } from "./src/ui";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

type Tab = "today" | "deadlines" | "settings";

interface Data {
  profile: Profile;
  briefing: BriefingRow | null;
  deadlines: DeadlineRow[];
  mailboxes: Mailbox[];
}

/** After mailbox sign-in on the web, the server sends the browser back with a result in the URL. */
function readReturnNotice(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const ok = params.get("mailbox_connected");
  const err = params.get("mailbox_error");
  if (!ok && !err) return null;
  window.history.replaceState(null, "", window.location.pathname);
  return ok ? `Connected ${ok}.` : `Mailbox not connected: ${err}`;
}

export default function App() {
  const t = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(readReturnNotice);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStarting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    const [p, b, d, m] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).single(),
      supabase.from("briefings").select("*").order("run_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("deadlines").select("id, course, task, action, due_date, due_time, source").order("due_date").order("due_time"),
      supabase.from("mail_connections").select("provider, email, connected_at"),
    ]);
    if (p.error || !p.data) {
      setLoadError("Couldn't load your account. Pull down to try again.");
      return;
    }
    setLoadError(null);
    setData({
      profile: p.data as Profile,
      briefing: (b.data as BriefingRow | null) ?? null,
      deadlines: (d.data as DeadlineRow[]) ?? [],
      mailboxes: (m.data as Mailbox[]) ?? [],
    });
  }, []);

  useEffect(() => {
    if (session) load();
    else setData(null);
  }, [session, load]);

  if (!configured) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Card title="Almost there">
          <Body>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in app/.env, then restart. See the README.</Body>
        </Card>
      </View>
    );
  }
  if (starting) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <SignIn />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "deadlines", label: "Deadlines" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Text style={[styles.title, { color: t.text }]}>{tabs.find((x) => x.key === tab)?.label}</Text>
        {notice ? (
          <Pressable onPress={() => setNotice(null)}>
            <Notice text={notice} />
          </Pressable>
        ) : null}
        {loadError ? <Notice tone="error" text={loadError} /> : null}
        {!data ? (
          <ActivityIndicator />
        ) : tab === "today" ? (
          <Today profile={data.profile} briefing={data.briefing} reload={load} goToSettings={() => setTab("settings")} />
        ) : tab === "deadlines" ? (
          <Deadlines profile={data.profile} deadlines={data.deadlines} />
        ) : (
          <Settings profile={data.profile} mailboxes={data.mailboxes} reload={load} />
        )}
      </ScrollView>
      <View style={[styles.tabbar, { borderColor: t.border, backgroundColor: t.card }]}>
        {tabs.map((x) => (
          <Pressable
            key={x.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === x.key }}
            onPress={() => setTab(x.key)}
            style={styles.tab}
          >
            <Text style={{ color: tab === x.key ? t.accent : t.muted, fontWeight: "600", fontSize: 15 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  content: { padding: 16, gap: 14, maxWidth: 640, width: "100%", alignSelf: "center", paddingBottom: 32 },
  title: { fontSize: 28, fontWeight: "700", marginTop: 8 },
  tabbar: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14 },
});
