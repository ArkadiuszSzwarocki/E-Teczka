import React, { useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { desktopDownloadPageUrl, sendDesktopDownloadEmail } from '../services/centralAccount';

const DEFAULT_CENTRAL_ORIGIN = (process.env.EXPO_PUBLIC_CENTRAL_ACCOUNT_URL || 'https://konto.arecki.pl').trim();

/** Mobile card offering 3 frictionless ways to install MojaTeczka Desktop on Windows or macOS. */
export default function DesktopDownloadCard({ centralOrigin = DEFAULT_CENTRAL_ORIGIN }: { centralOrigin?: string }) {
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState('');

  let pcUrl = 'https://konto.arecki.pl/pc';
  try {
    pcUrl = desktopDownloadPageUrl(centralOrigin);
  } catch { /* fallback */ }
  const shortLabel = pcUrl.replace(/^https?:\/\//i, '');

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await sendDesktopDownloadEmail(centralOrigin);
      setEmailSentTo(res.email);
      Alert.alert('Link wysłany', `Wysłaliśmy link do pobrania MojaTeczka na komputer na adres ${res.email}.`);
    } catch (error) {
      Alert.alert('Nie udało się wysłać e-maila', error instanceof Error ? error.message : 'Spróbuj udostępnić link przyciskiem poniżej.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleShareLink = async () => {
    try {
      await Share.share({
        title: 'MojaTeczka na komputer',
        message: `Pobierz MojaTeczka na komputer (Windows / macOS): ${pcUrl}`,
        url: pcUrl,
      });
    } catch { /* user cancelled */ }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="desktop-outline" size={20} color="#38bdf8" />
        <Text style={styles.title}>Nie masz jeszcze MojejTeczki na komputerze?</Text>
      </View>
      <Text style={styles.subtitle}>
        Pobierz wersję na Windows lub macOS jednym kliknięciem z telefonu:
      </Text>

      <TouchableOpacity
        style={[styles.emailBtn, sendingEmail && styles.disabled]}
        disabled={sendingEmail}
        onPress={() => void handleSendEmail()}
      >
        {sendingEmail ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <>
            <Ionicons name="mail-outline" size={18} color="#0f172a" />
            <Text style={styles.emailBtnText}>1. Wyślij link na mój e-mail</Text>
          </>
        )}
      </TouchableOpacity>
      {!!emailSentTo && <Text style={styles.sentNote}>✓ Wysłano link na {emailSentTo}</Text>}

      <TouchableOpacity style={styles.shareBtn} onPress={() => void handleShareLink()}>
        <Ionicons name="share-social-outline" size={18} color="#e0f2fe" />
        <Text style={styles.shareBtnText}>2. Udostępnij link (Quick Share / WhatsApp)</Text>
      </TouchableOpacity>

      <View style={styles.shortBox}>
        <Text style={styles.shortHint}>3. Lub wpisz w przeglądarce na komputerze:</Text>
        <Text selectable style={styles.shortUrl}>{shortLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, borderColor: '#334155', borderWidth: 1, marginTop: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { color: '#ffffff', fontSize: 15, fontWeight: '700', flex: 1 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  emailBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#38bdf8', padding: 12, borderRadius: 8, marginBottom: 8 },
  emailBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  sentNote: { color: '#4ade80', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1e3a5f', borderColor: '#38bdf8', borderWidth: 1, padding: 11, borderRadius: 8, marginBottom: 10 },
  shareBtnText: { color: '#e0f2fe', fontWeight: '600', fontSize: 13 },
  shortBox: { backgroundColor: '#1e293b', borderRadius: 8, padding: 10, alignItems: 'center' },
  shortHint: { color: '#94a3b8', fontSize: 11, marginBottom: 4 },
  shortUrl: { color: '#38bdf8', fontSize: 15, fontWeight: '700', letterSpacing: 0.4 },
  disabled: { opacity: 0.55 },
});
