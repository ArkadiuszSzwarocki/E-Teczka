import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { refreshCentralUser, loginCentralAccount, logoutCentralAccount, registerCentralAccount, requestCentralPasswordReset, resendCentralVerification, type CentralAccountUser } from '../services/centralAccount';
import { linkGoogleToCentral, signInToCentralWithGoogle } from '../services/centralGoogleSignIn';
import { errorMessage } from '../utils/errors';

export default function CentralAccountCard({ origin, googleWebClientId }: { origin: string; googleWebClientId: string }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [user, setUser] = useState<CentralAccountUser | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { void refreshCentralUser(origin).then(setUser).catch(() => setMessage('Nie udało się sprawdzić sesji. Połącz się z internetem.')); }, [origin]);
  const action = async (run: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await run(); } catch (error) { setMessage(errorMessage(error, 'Nie udało się połączyć.')); } finally { setBusy(false); } };
  return <View style={styles.card}>
    <Text style={styles.hint}>Konto centralne nie jest jeszcze połączone z kartotekami na komputerze.</Text>
    {user ? <><Text style={styles.text}>Zalogowano: {user.email}</Text>{Boolean(googleWebClientId) && <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => { await linkGoogleToCentral(origin, googleWebClientId); setMessage('Konto Google zostało połączone.'); })}><Text style={styles.text}>Połącz konto Google</Text></TouchableOpacity>}<TouchableOpacity disabled={busy} style={styles.button} onPress={() => void action(async () => { await logoutCentralAccount(origin); setUser(null); setMessage('Wylogowano.'); })}><Text style={styles.text}>Wyloguj konto</Text></TouchableOpacity></> : <>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="E-mail" placeholderTextColor="#94a3b8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Hasło" placeholderTextColor="#94a3b8" secureTextEntry autoComplete="password" />
      <TouchableOpacity disabled={busy} style={styles.button} onPress={() => void action(async () => { setUser(await loginCentralAccount(origin, email, password)); setPassword(''); })}><Text style={styles.text}>Zaloguj</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => { setMessage(`${(await registerCentralAccount(origin, email, password)).message} W wiadomości potwierdzisz adres e-mail.`); setPassword(''); })}><Text style={styles.text}>Utwórz konto</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setMessage((await resendCentralVerification(origin, email)).message))}><Text style={styles.text}>Wyślij ponownie potwierdzenie</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setMessage((await requestCentralPasswordReset(origin, email)).message))}><Text style={styles.text}>Nie pamiętam hasła</Text></TouchableOpacity>
      {Boolean(googleWebClientId) && <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setUser(await signInToCentralWithGoogle(origin, googleWebClientId)))}><Text style={styles.text}>Zaloguj przez Google</Text></TouchableOpacity>}
    </>}
    {busy && <ActivityIndicator color="#60a5fa" />}{Boolean(message) && <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
  </View>;
}

const styles = StyleSheet.create({ card: { padding: 18, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b', borderRadius: 12, gap: 10 }, input: { backgroundColor: '#0f172a', color: 'white', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#475569' }, button: { padding: 13, borderRadius: 8, backgroundColor: '#2563eb', alignItems: 'center' }, secondary: { padding: 13, borderRadius: 8, borderWidth: 1, borderColor: '#475569', alignItems: 'center' }, text: { color: '#f8fafc', fontWeight: '700' }, hint: { color: '#cbd5e1', lineHeight: 20 } });
