import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getApiUrl, getAuthHeaders } from "../services/localConnection";
import { fetchWithTimeout } from "../services/networkRequest";
import { getOfflineOcr } from "../services/offlineVault";

type Props = { documentId: number; onClose: () => void };
export default function OcrViewer({ documentId, onClose }: Props) {
  const [text, setText] = useState(""); const [message, setMessage] = useState("Pobieranie tekstu…"); const [busy, setBusy] = useState(true);
  const load = async () => {
    setBusy(true);
    try {
      const response = await fetchWithTimeout(await getApiUrl(`/api/ocr/${documentId}`), { headers: await getAuthHeaders() }, 7000, "Pobieranie OCR");
      const data = await response.json();
      if (!response.ok) { setText(""); setMessage(data.error || "Nie udało się pobrać OCR."); return; }
      setText(typeof data.text === "string" ? data.text : "");
      setMessage(data.state === 'processing' || data.state === 'queued' ? 'Rozpoznawanie trwa. Odśwież za chwilę.' : data.error || (data.text ? 'Tekst rozpoznany lokalnie na komputerze.' : 'Brak rozpoznanego tekstu. Wybierz „Rozpoznaj tekst”.'));
    } catch {
      const saved = await getOfflineOcr(documentId);
      setText(saved || ""); setMessage(saved ? "Kopia offline. Może nie zawierać najnowszych zmian." : "Brak połączenia i zapisanej kopii OCR. Pobierz kartotekę do telefonu, gdy komputer jest dostępny.");
    } finally { setBusy(false); }
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
  useEffect(() => { void load(); }, [documentId]);
  return <Modal visible animationType="slide" onRequestClose={onClose}><View style={styles.container}>
    <View style={styles.header}><Text style={styles.title}>Rozpoznany tekst (OCR)</Text><TouchableOpacity onPress={onClose} accessibilityLabel="Zamknij"><Text style={styles.buttonText}>Zamknij</Text></TouchableOpacity></View>
    <Text style={styles.message}>{message}</Text>{busy && <ActivityIndicator color="#60a5fa" />}
    <ScrollView style={styles.content}><Text selectable style={styles.text}>{text}</Text></ScrollView>
    <TouchableOpacity style={styles.button} onPress={() => void start()} disabled={busy}><Text style={styles.buttonText}>Rozpoznaj tekst</Text></TouchableOpacity>
    <TouchableOpacity style={styles.button} onPress={() => void load()} disabled={busy}><Text style={styles.buttonText}>Odśwież</Text></TouchableOpacity>
  </View></Modal>;
}
const styles = StyleSheet.create({ container:{flex:1,backgroundColor:'#0f172a',padding:18,paddingTop:45},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:20,fontWeight:'bold',color:'white'},message:{color:'#94a3b8',marginVertical:16},content:{flex:1,backgroundColor:'#1e293b',borderRadius:10,padding:14},text:{color:'#f1f5f9',fontSize:16,lineHeight:24},button:{backgroundColor:'#2563eb',padding:14,marginTop:12,borderRadius:8,alignItems:'center'},buttonText:{color:'white',fontWeight:'bold'} });
