import { View, Text, StyleSheet } from 'react-native';

// Renders the last 14 days as small colored squares.
// A square is filled (purple) if at least one application was logged that day.
function HeatmapDots({ applications = [] }) {
  const today = new Date();

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const prefix = d.toISOString().split('T')[0]; // "2026-06-01"

    // Applications can store the date in different field names depending on API version
    const active = applications.some(a =>
      (a.date ?? a.applied_at ?? a.created_at ?? '').startsWith(prefix)
    );

    return { prefix, active };
  });

  return (
    <View style={h.row}>
      {days.map(({ prefix, active }) => (
        <View key={prefix} style={[h.dot, active && h.dotActive]} />
      ))}
    </View>
  );
}

const h = StyleSheet.create({
  row:       { flexDirection: 'row', gap: 5, marginTop: 14 },
  dot:       { width: 16, height: 16, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)' },
  dotActive: { backgroundColor: '#a78bfa' },
});

// ─── STREAK CARD ──────────────────────────────────────────────────────────────

export default function StreakCard({ streak = 0, longestStreak = 0, applications = [] }) {
  return (
    <View style={s.card}>

      <View style={s.topRow}>
        <View>
          <Text style={s.streakNumber}>{streak}</Text>
          <Text style={s.streakSub}>day streak</Text>
        </View>
        <Text style={s.flame}>🔥</Text>
      </View>

      {longestStreak > 0 && (
        <Text style={s.best}>Best: {longestStreak} days</Text>
      )}

      <Text style={s.heatmapLabel}>Last 14 days</Text>
      <HeatmapDots applications={applications} />

    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  streakNumber: {
    fontSize: 60,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 64,
    letterSpacing: -2,
  },
  streakSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.40)',
    marginTop: 2,
  },
  flame: {
    fontSize: 42,
    marginTop: 6,
  },
  best: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.30)',
    marginTop: 4,
  },
  heatmapLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.28)',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: 12,
  },
});
