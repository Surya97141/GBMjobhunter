import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/utils/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen  from './src/screens/HomeScreen';
import LogScreen   from './src/screens/LogScreen';

const Stack = createStackNavigator();

// Shared header options — applied to all authenticated screens
const HEADER = {
  headerStyle: {
    backgroundColor: '#000000',
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: 1,
    elevation: 0,       // Android: removes drop shadow
    shadowOpacity: 0,   // iOS: removes drop shadow
  },
  headerTintColor:  '#ffffff',
  headerTitleStyle: { fontWeight: '700', fontSize: 17 },
  cardStyle:        { backgroundColor: '#000000' },
};

// RootNavigator reads AuthContext to decide which stack to render.
// Swapping between stacks happens automatically when token changes —
// no manual navigation.navigate('Login') needed on sign-out.
function RootNavigator() {
  const { token, loading } = useAuth();

  // Render nothing while SecureStore is reading the token on cold start
  if (loading) return null;

  return (
    <Stack.Navigator screenOptions={HEADER}>
      {token ? (
        // ── Authenticated stack ──────────────────────────────────────────────
        <>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'GBM' }}
          />
          <Stack.Screen
            name="Log"
            component={LogScreen}
            options={{ title: 'Log Activity' }}
          />
        </>
      ) : (
        // ── Auth stack ───────────────────────────────────────────────────────
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
