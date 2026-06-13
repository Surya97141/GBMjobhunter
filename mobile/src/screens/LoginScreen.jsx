import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import client from '../api/client';
import { useAuth } from '../utils/AuthContext';

export default function LoginScreen() {
  const { signIn }                    = useAuth();
  const [email,    setEmail]          = useState('');
  const [password, setPassword]       = useState('');
  const [loading,  setLoading]        = useState(false);

  async function handleLogin() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await client.post('/users/login', {
        email:    trimmedEmail,
        password,
      });
      await signIn(data.token);
      // Navigation happens automatically — AuthContext token change triggers
      // RootNavigator to swap to the app stack.
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Sign in failed. Check your credentials.';
      Alert.alert('Sign in failed', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.root}
    >
      <View style={s.container}>

        {/* Brand */}
        <View style={s.brand}>
          <View style={s.brandDot} />
          <Text style={s.brandName}>GBM</Text>
        </View>

        <Text style={s.tagline}>
          Job search intelligence{'\n'}in your pocket.
        </Text>

        {/* Form */}
        <View style={s.form}>

          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="next"
            placeholder="you@example.com"
            placeholderTextColor="rgba(255,255,255,0.22)"
          />

          <Text style={[s.label, { marginTop: 18 }]}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            placeholder="••••••••"
            placeholderTextColor="rgba(255,255,255,0.22)"
          />

          <Pressable
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#ffffff" />
              : <Text style={s.btnLabel}>Sign in</Text>
            }
          </Pressable>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#a78bfa',
  },
  brandName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#a78bfa',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 48,
  },
  form: {},
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 8,
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
  btn: {
    marginTop: 28,
    backgroundColor: '#a78bfa',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
