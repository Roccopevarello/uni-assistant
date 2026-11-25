import React from "react";
import { Text, View } from "react-native";
import { addDays, dayLabel, daysLeft, localToday } from "../lib/dates";
import type { DeadlineRow, Profile } from "../lib/types";
import { Body, Card, useTheme } from "../ui";

function when(d: DeadlineRow): string {
  return `${dayLabel(d.due_date)}${d.due_time ? ` by ${d.due_time}` : ""}`;
}

function left(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}

export default function Deadlines({ profile, deadlines }: { profile: Profile; deadlines: DeadlineRow[] }) {
  const t = useTheme();
  const today = localToday(profile.time_zone);
  const upcoming = deadlines.filter((d) => daysLeft(today, d.due_date) >= 0);

  if (!upcoming.length) {
    return (
      <Card title="No upcoming deadlines">
        <Body muted>Deadlines found in your email and on Blackboard show up here and in your deadline calendar.</Body>
      </Card>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {upcoming.map((d) => {
        const n = daysLeft(today, d.due_date);
        const soon = n <= 3;
        return (
          <Card key={d.id} style={soon ? { borderColor: t.accent, borderWidth: 2 } : undefined}>
            <View style={{ gap: 4 }}>
              <Text style={{ color: t.muted, fontSize: 13 }}>{d.course}</Text>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>
                {d.task}: {d.action}
              </Text>
              <Text style={{ color: soon ? t.accent : t.text, fontSize: 15 }}>
                {when(d)} · {left(n)}
              </Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>
                Calendar event {dayLabel(addDays(d.due_date, -2))} · reminder {dayLabel(addDays(d.due_date, -3))} · from{" "}
                {d.source === "blackboard" ? "Blackboard" : "email"}
              </Text>
            </View>
          </Card>
        );
      })}
    </View>
  );
}
