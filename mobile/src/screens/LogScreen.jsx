import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import client from '../api/client';

const STATUSES = [
  { key: 'applied',      label: 'Applied',    colour: '#a78bfa' },
  { key: 'interviewing', label: 'Interview',  colour: '#fbbf24' },
  { key: 'offer',        label: 'Offer',      colour: '#34d399' },
  { key: 'rejected',     label: 'Rejected',   colour: '#f87171' },
];

export default function LogScreen({ navigation }) {
  const [company, setCompany] = useState('');
  const [role,    setRole]    = useState('');
  const [status,  setStatus]  = useState('applied');
  const [notes,   setNotes]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const trimCompany = company.trim();
    const trimRole    = role.trim();

    if (!trimCompany || !trimRole) {
      Alert.alert('Missing fields', 'Company and role are required.');
      return;
    }

    setLoading(true);
    try {
      await client.post('/applications', {
        companyName: trimCompany,
        roleTitle:   trimRole,
      });
      // Pop back to Home — useFocusEffect there will refresh the list
      navigation.goBack();
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to log application.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.root}
    >
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >

        {/* Company */}
        <Text style={s.label}>Company</Text>
        <TextInput
          style={s.input}
          value={company}
          onChangeText={setCompany}
          placeholder="Stripe, Linear, Vercel…"
          placeholderTextColor="rgba(255,255,255,0.22)"
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Role */}
        <Text style={[s.label, { marginTop: 18 }]}>Role</Text>
        <TextInput
          style={s.input}
          value={role}
          onChangeText={setRole}
          placeholder="Senior Frontend Engineer"
          placeholderTextColor="rgba(255,255,255,0.22)"
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Status chips */}
        <Text style={[s.label, { marginTop: 22 }]}>Status</Text>
        <View style={s.chipRow}>
          {STATUSES.map(({ key, label, colour }) => {
            const active = status === key;
            return (
              <Pressable
                key={key}
                style={[
                  s.chip,
                  active
                    ? { backgroundColor: colour, borderColor: colour }
                    : { borderColor: 'rgba(255,255,255,0.18)' },
                ]}
                onPress={() => setStatus(key)}
              >
                <Text style={[s.chipLabel, active && s.chipLabelActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Notes */}
        <Text style={[s.label, { marginTop: 22 }]}>
          Notes{' '}
          <Text style={s.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={[s.input, s.textArea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Recruiter name, referral, interview round…"
          placeholderTextColor="rgba(255,255,255,0.22)"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [s.btn, pressed && { opacity: 0.82 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#ffffff" />
            : <Text style={s.btnLabel}>Log Application</Text>
          }
        </Pressable>

      </ScrollView>
    </KeyboardAvoidingView>
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
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  optional: {
    fontWeight: '400',
    textTransform: 'none',
    letterSpacing: 0,
    color: 'rgba(255,255,255,0.28)',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 15,
  },
  textArea: {
    height: 96,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.70)',
  },
  chipLabelActive: {
    color: '#000000',
  },
  btn: {
    marginTop: 32,
    backgroundColor: '#a78bfa',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
