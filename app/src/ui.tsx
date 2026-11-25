import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

const light = {
  bg: "#F6F5F2",
  card: "#FFFFFF",
  text: "#1C1B19",
  muted: "#6B6862",
  border: "#E3E0DA",
  accent: "#2F5BD3",
  accentText: "#FFFFFF",
  warnBg: "#FFF4E0",
  warnText: "#7A4A00",
  dangerText: "#B3261E",
};
const dark: typeof light = {
  bg: "#141413",
  card: "#1E1E1C",
  text: "#F2F1EE",
  muted: "#A3A09A",
  border: "#33322F",
  accent: "#7C9BFF",
  accentText: "#0D1330",
  warnBg: "#3A2A0E",
  warnText: "#F5C877",
  dangerText: "#FF8A80",
};
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>
      {title ? <Text style={[styles.cardTitle, { color: t.text }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: muted ? t.muted : t.text }, style]}>{children}</Text>;
}

export function Bullets({ items, empty }: { items: string[]; empty?: string }) {
  const t = useTheme();
  if (!items.length) return empty ? <Body muted>{empty}</Body> : null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={[styles.body, { color: t.muted }]}>•</Text>
          <Text style={[styles.body, { color: t.text, flex: 1 }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? t.accent : "transparent",
          borderColor: primary ? t.accent : t.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? t.accentText : t.text} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? t.accentText : kind === "danger" ? t.dangerText : t.text }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: t.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.bg }]}
      />
      {hint ? <Text style={[styles.hint, { color: t.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ text, tone = "warn" }: { text: string; tone?: "warn" | "error" }) {
  const t = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: t.warnBg }]}>
      <Text style={[styles.body, { color: tone === "error" ? t.dangerText : t.warnText }]}>{text}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: t.border }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, { backgroundColor: on ? t.accent : "transparent" }]}
          >
            <Text style={[styles.buttonText, { color: on ? t.accentText : t.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 14, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  button: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", minHeight: 46, justifyContent: "center" },
  buttonText: { fontSize: 15, fontWeight: "600" },
  notice: { borderRadius: 10, padding: 12 },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  segment: { flex: 1, paddingVertical: 10, alignItems: "center" },
});
