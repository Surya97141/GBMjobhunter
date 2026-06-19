import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import StreakCard from '../components/StreakCard';
import client from '../api/client';
import { useAuth } from '../utils/AuthContext';

const OUTCOME_COLOUR = {
  applied:      '#a78bfa',
  interviewing: '#fbbf24',
  offer:        '#34d399',
  rejected:     '#f87171',
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

export default function HomeScreen({ navigation }) {
  const { signOut } = useAuth();

  const [user,         setUser]         = useState(null);
  const [applications, setApplications] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  async function fetchData() {
    try {
      const [meRes, appsRes] = await Promise.all([
        client.get('/users/me'),
        client.get('/applications?limit=10'),
      ]);
      setUser(meRes.data.user ?? meRes.data);
      setApplications(appsRes.data.applications ?? appsRes.data ?? []);
    } catch (_) {
      // Leave existing state in place on fetch error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Re-fetch each time this screen gains focus so streak + list stay fresh
  // after the user logs a new application on LogScreen.
  useFocusEffect(useCallback(() => { fetchData(); }, []));

  function onRefresh() {
    setRefreshing(true);
    fetchData();
  }

  const firstName    = user?.name?.split(' ')[0] ?? user?.firstName ?? 'there';
  const streak       = user?.streak?.current ?? 0;
  const bestStreak   = user?.streak?.longest ?? 0;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#a78bfa"
        />
      }
    >
      {/* Header row */}
      <View style={s.header}>
        <Text style={s.greeting}>{getGreeting()}, {firstName}.</Text>
        <Pressable onPress={signOut} hitSlop={12}>
          <Text style={s.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {/* Streak card */}
      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator color="#a78bfa" />
        </View>
      ) : (
        <StreakCard
          streak={streak}
          longestStreak={bestStreak}
          applications={applications}
        />
      )}

      {/* Primary action */}
      <Pressable
        style={({ pressed }) => [s.logBtn, pressed && { opacity: 0.82 }]}
        onPress={() => navigation.navigate('Log')}
      >
        <Text style={s.logBtnLabel}>+ Log Activity</Text>
      </Pressable>

      {/* Recent applications */}
      {applications.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Recent Activity</Text>

          {applications.slice(0, 5).map((app, i) => {
            const colour = OUTCOME_COLOUR[app.status] ?? 'rgba(255,255,255,0.25)';
            return (
              <View key={app.id ?? i} style={s.appRow}>
                <View style={[s.appDot, { backgroundColor: colour }]} />
                <View style={s.appInfo}>
                  <Text style={s.appCompany}>{app.company}</Text>
                  <Text style={s.appRole} numberOfLines={1}>{app.role}</Text>
                </View>
                <Text style={s.appDate}>
                  {formatDate(app.date ?? app.applied_at ?? app.created_at)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  signOut: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
  },
  loadingBox: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logBtn: {
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: '#a78bfa',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logBtnLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  appDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  appInfo: {
    flex: 1,
  },
  appCompany: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  appRole: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.50)',
    marginTop: 2,
  },
  appDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    flexShrink: 0,
  },
});
