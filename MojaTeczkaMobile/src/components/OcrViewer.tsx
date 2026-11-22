import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { fetchWithTimeout } from "../services/networkRequest";
import { getOfflineOcr } from "../services/offlineVault";

const PAGE_CHARS = 8000;
const BLOCK_CHARS = 1200;

function splitBlocks(raw: string): string[] {
  if (!raw) return [];
  const blocks: string[] = [];
  for (let i = 0; i < raw.length; i += BLOCK_CHARS) {
    blocks.push(raw.slice(i, i + BLOCK_CHARS));
  }
  return blocks;
}

type Props = { documentId: number; onClose: () => void };
export default function OcrViewer({ documentId, onClose }: Props) {
  const [text, setText] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("Pobieranie tekstu…");
  const [busy, setBusy] = useState(true);
  const blocks = useMemo(() => splitBlocks(text), [text]);

  const load = async (nextOffset = 0) => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout(
        await getApiUrl(`/api/ocr/${documentId}?offset=${nextOffset}&limit=${PAGE_CHARS}`),
        { headers: await getAuthHeaders() },
        7000,
        "Pobieranie OCR",
      );
      const data = await response.json();
      if (!response.ok) {
        if (nextOffset === 0) setText("");
        setHasMore(false);
        setMessage(data.error || "Nie udało się pobrać OCR.");
        return;
      }
      const chunk = typeof data.text === "string" ? data.text : "";
      setText(prev => (nextOffset === 0 ? chunk : prev + chunk));
      setHasMore(Boolean(data.hasMore));
      setMessage(
        data.state === 'processing' || data.state === 'queued'
          ? 'Rozpoznawanie trwa. Odśwież za chwilę.'
          : data.error || (chunk || nextOffset > 0 ? 'Tekst rozpoznany lokalnie na komputerze.' : 'Brak rozpoznanego tekstu. Wybierz „Rozpoznaj tekst”.'),
      );
    } catch {
      if (nextOffset === 0) {
        const saved = await getOfflineOcr(documentId);
        setText(saved || "");
        setHasMore(false);
        setMessage(saved ? "Kopia offline. Może nie zawierać najnowszych zmian." : "Brak połączenia i zapisanej kopii OCR. Pobierz kartotekę do telefonu, gdy komputer jest dostępny.");
      }
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout(await getApiUrl(`/api/ocr/${documentId}`), { method: 'POST', headers: await getAuthHeaders() }, 10000, 'Uruchamianie OCR');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || 'Nie udało się uruchomić OCR.'); return; }
      setMessage('Dokument dodano do kolejki OCR. Odśwież za chwilę.');
    } catch { setMessage('Nie udało się uruchomić OCR. Sprawdź połączenie z komputerem.'); }
    finally { setBusy(false); }
  };

  useEffect(() => { void load(0); }, [documentId]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Rozpoznany tekst (OCR)</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Zamknij"><Text style={styles.buttonText}>Zamknij</Text></TouchableOpacity>
        </View>
        <Text style={styles.message}>{message}</Text>
        {busy && <ActivityIndicator color="#60a5fa" />}
        <FlatList
          style={styles.content}
          data={blocks}
          keyExtractor={(_, idx) => String(idx)}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
          renderItem={({ item }) => <Text selectable style={styles.text}>{item}</Text>}
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity style={styles.loadMoreButton} onPress={() => void load(text.length)} disabled={busy}>
                <Text style={styles.buttonText}>Załaduj więcej tekstu</Text>
              </TouchableOpacity>
            ) : null
          }
        />
        <TouchableOpacity style={styles.button} onPress={() => void start()} disabled={busy}><Text style={styles.buttonText}>Rozpoznaj tekst</Text></TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => void load(0)} disabled={busy}><Text style={styles.buttonText}>Odśwież</Text></TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 18, paddingTop: 45 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: 'white' },
  message: { color: '#94a3b8', marginVertical: 16 },
  content: { flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 14 },
  text: { color: '#f1f5f9', fontSize: 16, lineHeight: 24, marginBottom: 8 },
  loadMoreButton: { backgroundColor: '#334155', padding: 12, marginTop: 8, marginBottom: 16, borderRadius: 8, alignItems: 'center' },
  button: { backgroundColor: '#2563eb', padding: 14, marginTop: 12, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: 'bold' },
});
