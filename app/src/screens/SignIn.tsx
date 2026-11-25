import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { Body, Button, Card, Field, Notice, useTheme } from "../ui";

/** Email sign-in with a 6-digit code: works the same on web, iPhone and Android. */
export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError("That code didn't work. Check it, or ask for a new one.");
  }

  return (
    <ScrollView contentContainerStyle={[styles.wrap, { backgroundColor: t.bg }]}>
      <View style={{ gap: 6 }}>
        <Text style={[styles.title, { color: t.text }]}>Uni Assistant</Text>
        <Body muted>Every morning: your deadlines, the emails that need you, and what's on today.</Body>
      </View>
      <Card>
        {!sent ? (
          <>
            <Field
              label="Your email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="you@student.ie.edu"
              autoComplete="email"
            />
            <Button label="Send me a sign-in code" onPress={sendCode} busy={busy} disabled={!email.includes("@")} />
          </>
        ) : (
          <>
            <Body>We sent a 6-digit code to {email}.</Body>
            <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" autoComplete="one-time-code" />
            <Button label="Sign in" onPress={verify} busy={busy} disabled={code.trim().length < 6} />
            <Button label="Use a different email" kind="secondary" onPress={() => { setSent(false); setCode(""); }} />
          </>
        )}
        {error ? <Notice tone="error" text={error} /> : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 20, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontSize: 30, fontWeight: "700" },
});
