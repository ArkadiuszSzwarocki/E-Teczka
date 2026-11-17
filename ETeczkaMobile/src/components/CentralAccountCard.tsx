import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { activePromotions, chooseAnotherMobileAccount, deleteCentralAccount, getCentralCatalog, privacyPolicyUrl, refreshCentralUser, loginCentralAccount, logoutCentralAccount, registerCentralAccount, requestCentralPasswordReset, resendCentralVerification, type CentralAccountUser, type CentralPromotion } from '../services/centralAccount';
import { linkGoogleToCentral, signInToCentralWithGoogle } from '../services/centralGoogleSignIn';
import { errorMessage } from '../utils/errors';
import {getCentralPlanUsage,type CentralPlanName,type CentralPlanUsage} from '../services/centralAccount';

const PLAN_LABELS: Record<CentralPlanName, string> = {
  free: 'Darmowy',
  standard: 'Standard',
  premium: 'Premium',
  family: 'Rodzinny',
  business: 'Biznes',
};

export default function CentralAccountCard({ origin, googleWebClientId }: { origin: string; googleWebClientId: string }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [user, setUser] = useState<CentralAccountUser | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [usage,setUsage]=useState<CentralPlanUsage|null>(null);
  const [promotions, setPromotions] = useState<CentralPromotion[]>([]);
  useEffect(() => { let active = true; void getCentralCatalog(origin).then(cat => { if (active && cat) setPromotions(activePromotions(cat)); }).catch(() => undefined); return () => { active = false; }; }, [origin]);
  useEffect(()=>{let active=true;if(!user){setUsage(null);return;}void getCentralPlanUsage(origin).then(value=>{if(active)setUsage(value);}).catch(()=>undefined);return()=>{active=false;};},[origin,user]);
  useEffect(() => { void refreshCentralUser(origin).then(setUser).catch(() => setMessage('Nie udało się sprawdzić sesji. Połącz się z internetem.')); }, [origin]);
  const action = async (run: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await run(); } catch (error) { setMessage(errorMessage(error, 'Nie udało się połączyć.')); } finally { setBusy(false); } };
  const confirmDelete = () => Alert.alert('Usuń konto trwale', 'Konto centralne oraz jego sesje zostaną trwale usunięte. Operacji nie można cofnąć.', [
    { text: 'Anuluj', style: 'cancel' },
    { text: 'Usuń konto', style: 'destructive', onPress: () => void action(async () => { await deleteCentralAccount(origin); setUser(null); setMessage('Konto zostało trwale usunięte.'); }) }
  ]);
  return <View style={styles.card}>
    <Text style={styles.hint}>Plan i limity są wspólne dla konta na wszystkich urządzeniach.</Text>
    {promotions.length > 0 && <View style={styles.promoBox}>{promotions.map(p => <Text key={p.id} style={styles.promoText}>Promocja −{p.percent}% ({p.name}) · {PLAN_LABELS[p.plan] || p.plan} {p.interval === 'yearly' ? 'rocznie' : 'miesięcznie'}</Text>)}</View>}
    {user&&usage&&<View><Text style={styles.text}>Plan: {PLAN_LABELS[usage.plan] || usage.plan}</Text>{([['documents','Dokumenty'],['tags','Tagi'],['cameraScan','Skany z aparatu'],['printerScan','Skany z drukarki'],['merge','Łączenie plików']] as const).map(([key,label])=><Text key={key} style={styles.hint}>{label}: {Math.max(0,usage[key].used-(usage[key].reservedOffline||0))} / {usage[key].limit===null?'bez limitu':usage[key].limit}{Boolean(usage[key].reservedOffline)&&` · rezerwacja offline: ${usage[key].reservedOffline}`}</Text>)}<TouchableOpacity disabled={busy} style={styles.secondary} onPress={()=>void action(async()=>setUsage(await getCentralPlanUsage(origin)))}><Text style={styles.text}>Odśwież wspólne limity</Text></TouchableOpacity></View>}
    {user ? <><Text style={styles.text}>Zalogowano: {user.email}</Text><TouchableOpacity disabled={busy} style={styles.secondary} onPress={()=>void action(async()=>{await chooseAnotherMobileAccount(origin);})}><Text style={styles.text}>Zmień konto — zachowaj sejf</Text></TouchableOpacity>{Boolean(googleWebClientId) && <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => { await linkGoogleToCentral(origin, googleWebClientId); setMessage('Konto Google zostało połączone.'); })}><Text style={styles.text}>Połącz konto Google</Text></TouchableOpacity>}<TouchableOpacity disabled={busy} style={styles.button} onPress={() => void action(async () => { await logoutCentralAccount(origin); setUser(null); setMessage('Wylogowano.'); })}><Text style={styles.text}>Wyloguj konto</Text></TouchableOpacity><TouchableOpacity disabled={busy} style={styles.danger} onPress={confirmDelete}><Text style={styles.dangerText}>Usuń konto trwale</Text></TouchableOpacity></> : <>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="E-mail" placeholderTextColor="#94a3b8" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Hasło" placeholderTextColor="#94a3b8" secureTextEntry autoComplete="password" />
      <TouchableOpacity disabled={busy} style={styles.button} onPress={() => void action(async () => { setUser(await loginCentralAccount(origin, email, password)); setPassword(''); })}><Text style={styles.text}>Zaloguj</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => { setMessage(`${(await registerCentralAccount(origin, email, password)).message} W wiadomości potwierdzisz adres e-mail.`); setPassword(''); })}><Text style={styles.text}>Utwórz konto</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setMessage((await resendCentralVerification(origin, email)).message))}><Text style={styles.text}>Wyślij ponownie potwierdzenie</Text></TouchableOpacity>
      <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setMessage((await requestCentralPasswordReset(origin, email)).message))}><Text style={styles.text}>Nie pamiętam hasła</Text></TouchableOpacity>
      {Boolean(googleWebClientId) && <TouchableOpacity disabled={busy} style={styles.secondary} onPress={() => void action(async () => setUser(await signInToCentralWithGoogle(origin, googleWebClientId)))}><Text style={styles.text}>Zaloguj przez Google</Text></TouchableOpacity>}
    </>}
    {busy && <ActivityIndicator color="#60a5fa" />}{Boolean(message) && <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
    <TouchableOpacity onPress={() => void Linking.openURL(privacyPolicyUrl(origin))}><Text style={styles.link}>Polityka prywatności</Text></TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({ card: { padding: 18, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1e293b', borderRadius: 12, gap: 10 }, input: { backgroundColor: '#0f172a', color: 'white', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#475569' }, button: { padding: 13, borderRadius: 8, backgroundColor: '#2563eb', alignItems: 'center' }, secondary: { padding: 13, borderRadius: 8, borderWidth: 1, borderColor: '#475569', alignItems: 'center' }, danger: { padding: 13, borderRadius: 8, borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' }, dangerText: { color: '#fca5a5', fontWeight: '700' }, link: { color: '#93c5fd', textAlign: 'center', fontSize: 13, marginTop: 4 }, text: { color: '#f8fafc', fontWeight: '700' }, hint: { color: '#cbd5e1', lineHeight: 20 }, promoBox: { backgroundColor: '#064e3b', borderColor: '#10b981', borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 }, promoText: { color: '#a7f3d0', fontSize: 13, fontWeight: '600' } });
