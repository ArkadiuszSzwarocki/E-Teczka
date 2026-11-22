# Wykaz zgód i klauzul informacyjnych E-Teczka

Poniżej znajduje się zestawienie wszystkich zgód zbieranych od użytkownika w aplikacji oraz ich dokładne miejsce zapisu.

---

## 1. Zgoda testera na tryb przechowywania danych (wersja testowa WWW)
- **Gdzie się wyświetla:** Pierwsze okno modalne po zalogowaniu na `https://e-teczkatest.arecki.pl` ([TesterConsentModal.tsx](file:///a:/GitHub/E-Teczka/frontend/src/components/TesterConsentModal.tsx)).
- **Treść zgody:**
  > *„Rozumiem zasady przechowywania danych w wersji testowej i wyrażam zgodę na zapisanie mojego wyboru oraz odnotowanie tej zgody w bazie konta testowego.”*
- **Opcje wyboru:**
  1. `local_disk` (domyślnie) — plik bazy `mojateczka-db.json` i fizyczne pliki w `uploads/` zapisywane są bezpośrednio we wskazanym folderze na dysku komputera użytkownika.
  2. `qnap_server` — dokumenty w testowej bazie SQLite na serwerze QNAP.
- **Gdzie jest odnotowana:** tabela `TesterConsent` w bazie `eteczka.db` na QNAP-ie (`userId`, `email`, `accepted`, `storageMode`, `policyVersion`, `acceptedAt`).
- **Odmowa:** zapisuje `accepted = 0` i wylogowuje użytkownika z aplikacji.

---

## 2. Zgoda na założenie konta i Politykę Prywatności (`konto.arecki.pl`)
- **Gdzie się wyświetla:** Ekran rejestracji / logowania przez Google oraz stopka karty konta centralnego (`https://konto.arecki.pl/privacy`).
- **Zakres:** Przetwarzanie adresu e-mail, nazwy konta, sesji oraz listy zaufanych urządzeń w celu świadczenia usługi.

---

## 3. Zgoda na zaproszenie do Grupy Rodzinnej
- **Gdzie się wyświetla:** Okno **„Rodzina i zaproszenia”** ([FamilySettingsModal.tsx](file:///a:/GitHub/E-Teczka/frontend/src/components/FamilySettingsModal.tsx)).
- **Zasada:** Dołączenie wymaga świadomej akceptacji zaproszenia przez zaproszonego użytkownika po zalogowaniu na jego własne konto (`POST /api/family/accept`). Zapisuje się w tabeli `FamilyMember` i `FamilyInvite` (`acceptedAt`).

---

## 4. Zgłoszenia błędów i uwagi (Feedback)
- **Gdzie się wyświetla:** Przycisk **„Zgłoś błąd / uwagę”** w panelu bocznym.
- **Zakres:** Użytkownik dobrowolnie wysyła opis zgłoszenia oraz opcjonalny zrzut ekranu (z możliwością zamazania poufnych fragmentów przed wysłaniem).

---

## 5. Uprawnienia aplikacji mobilnej (`MojaTeczkaMobile` Android)
System Android pyta użytkownika o jednorazową zgodę przy pierwszym użyciu funkcji:
- **Aparat** — skanowanie dokumentów aparatem oraz skanowanie kodu QR do parowania z komputerem.
- **Powiadomienia** — przypomnienia o zbliżającym się terminie życia dokumentów (`retentionNotifications`).
- **Sieć lokalna / Wi-Fi** — parowanie i przesyłanie dokumentów do E-Teczki na komputerze.
