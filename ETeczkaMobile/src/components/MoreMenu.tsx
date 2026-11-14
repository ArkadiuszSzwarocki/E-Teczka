import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type MoreSection = 'connection' | 'sync' | 'alerts' | 'settings';

export default function MoreMenu({ onOpen, onLock }: { onOpen: (section: MoreSection) => void; onLock: () => void }) {
  const items: { section: MoreSection; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { section: 'settings', title: 'Ustawienia', subtitle: 'PIN, hasło, biometria i blokada', icon: 'settings-outline' },
    { section: 'connection', title: 'Połączenie z komputerem', subtitle: 'Adres, kod i parowanie', icon: 'desktop-outline' },
    { section: 'sync', title: 'Synchronizacja', subtitle: 'Kopie offline i oczekujące zmiany', icon: 'sync-outline' },
    { section: 'alerts', title: 'Terminy', subtitle: 'Powiadomienia o dokumentach', icon: 'notifications-outline' },
  ];
  return <View style={styles.menu}>{items.map(item => <TouchableOpacity key={item.section} accessibilityRole="button" onPress={() => onOpen(item.section)} style={styles.row}><Ionicons name={item.icon} size={23} color="#60a5fa" /><View style={styles.labels}><Text style={styles.title}>{item.title}</Text><Text style={styles.subtitle}>{item.subtitle}</Text></View><Ionicons name="chevron-forward" size={18} color="#94a3b8" /></TouchableOpacity>)}<TouchableOpacity accessibilityRole="button" onPress={onLock} style={styles.row}><Ionicons name="log-out-outline" size={23} color="#f87171" /><View style={styles.labels}><Text style={styles.title}>Wyloguj / zablokuj</Text><Text style={styles.subtitle}>Zamknij dostęp do aplikacji</Text></View><Ionicons name="chevron-forward" size={18} color="#94a3b8" /></TouchableOpacity></View>;
}

const styles = StyleSheet.create({
  menu: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 12, padding: 16 },
  labels: { flex: 1 }, title: { color: '#f8fafc', fontSize: 16, fontWeight: '700' }, subtitle: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
});
