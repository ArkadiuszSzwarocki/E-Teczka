# Polityka Prywatności aplikacji E-Teczka

> **Uwaga przed publikacją produkcyjną:** Uzupełnij dane Administratora oznaczone w nawiasach `[...]` oraz skonsultuj treść z prawnikiem pod kątem finalnego modelu sprzedaży (Stripe / Google Play).

---

## 1. Administrator Danych Osobowych
Administratorem Twoich danych osobowych jest:
- **Podmiot:** `[Imię i nazwisko / Nazwa firmy]`
- **Adres:** `[Ulica, kod pocztowy, miasto]`
- **NIP / REGON / KRS:** `[opcjonalnie]`
- **Kontakt w sprawach prywatności i RODO:** `[adres e-mail kontaktowy, np. kontakt@arecki.pl]`

---

## 2. Jakie dane przetwarzamy i w jakim celu?

### A. Dane konta centralnego (`konto.arecki.pl`)
- **Zakres:** adres e-mail, nazwa wyświetlana (opcjonalnie), skrót hasła (hash), identyfikator konta Google (jeśli wybierzesz logowanie przez Google), identyfikatory zaufanych urządzeń (`deviceId`, `deviceName`), aktywny plan i status płatności.
- **Cel:** rejestracja konta, uwierzytelnianie, obsługa sesji, zarządzanie zaufanymi urządzeniami oraz rozliczenia planów (Darmowy, Standard, Premium, Rodzinny, Firmowy).
- **Podstawa prawna:** art. 6 ust. 1 lit. b RODO (wykonanie umowy / świadczenie usługi drogą elektroniczną).

### B. Dokumenty, kartoteki i załączniki użytkowników
Aplikacja E-Teczka działa w modelu **Local-First (prywatność przede wszystkim)**:
- **W aplikacji desktopowej (Windows):** Twoje dokumenty, kartoteki i pliki są przechowywane lokalnie na Twoim komputerze (baza SQLite + lokalny folder plików + szyfrowane pliki konfiguracyjne Sejfu).
- **W publicznej wersji testowej WWW (`e-teczkatest.arecki.pl`):**
  - domyślnie (po wyrażeniu zgody w pierwszym oknie) Twoje dokumenty i kartoteki zapisywane są **bezpośrednio we wskazanym przez Ciebie folderze na Twoim dysku** (`mojateczka-db.json` + podfolder `uploads/`) i nie są wysyłane na serwer QNAP;
  - jeśli dobrowolnie wybierzesz **tryb serwerowy QNAP** (np. do testów Pakietu Rodzinnego między urządzeniami), dokumenty zapisywane są w testowej bazie SQLite na serwerze QNAP wyłącznie na czas testów.
- **W aplikacji mobilnej (Android):** skany mogą być zapisywane offline w zaszyfrowanym magazynie urządzenia lub przesyłane bezpośrednio w sieci lokalnej Wi-Fi (HTTPS) na Twój komputer.

### C. Zgody testerów i logi bezpieczeństwa
- W wersji testowej WWW w bazie serwera zapisywana jest Twoja zgoda na warunki przechowywania danych (`userId`, `email`, wybrane miejsce przechowywania `local_browser` / `qnap_server`, wersja polityki i data decyzji).
- W logach technicznych mogą być zapisywane podstawowe zdarzenia błędów i informacje o żądaniach sieciowych (adres IP, nagłówki bezpieczeństwa Cloudflare) wyłącznie w celu ochrony przed nadużyciami (rate limiting, art. 6 ust. 1 lit. f RODO).

### D. Kopie zapasowe w chmurze i integracje zewnętrzne (opcjonalne)
- Jeśli skonfigurujesz kopię zapasową na własny serwer NAS (WebDAV/QNAP) lub chmurę (np. Google Drive), dane kopii wysyłane są wyłącznie na Twoje wyraźne polecenie do wybranego przez Ciebie dostawcy.
- Jeśli korzystasz z płatności online (Stripe / Google Play), dane płatnicze (numer karty itp.) są przetwarzane bezpośrednio przez operatora płatności zgodnie z jego polityką prywatności — E-Teczka nie przechowuje danych kart płatniczych.

---

## 3. Odbiorcy danych i transfer poza EOG
- **Cloudflare** — pośrednictwo sieciowe, ochrona przed atakami i tunelowanie ruchu WWW (`e-teczkatest.arecki.pl`, `konto.arecki.pl`).
- **Google LLC** — wyłącznie w przypadku skorzystania z opcji logowania przez Google OAuth lub kopii zapasowej Google Drive.
- **Stripe / Google Play** — wyłącznie przy zakupie płatnych planów.

---

## 4. Okres przechowywania danych
- **Dane konta:** do czasu usunięcia konta przez użytkownika (w panelu `konto.arecki.pl/account` lub na żądanie wysłane do Administratora).
- **Dane lokalne (komputer / przeglądarka `IndexedDB`):** pod pełną kontrolą użytkownika — do czasu ich usunięcia w aplikacji, opróżnienia Kosza lub wyczyszczenia danych przeglądarki.
- **Dane testowe na serwerze QNAP (jeśli wybrano tryb serwerowy):** do zakończenia testów lub usunięcia przez użytkownika.

---

## 5. Twoje prawa (RODO)
Masz prawo do:
1. Dostępu do swoich danych i uzyskania ich kopii.
2. Sprostowania nieprawidłowych danych.
3. Usunięcia danych („prawo do bycia zapomnianym”) — w tym trwałego usunięcia konta w panelu konta.
4. Ograniczenia przetwarzania oraz przenoszenia danych.
5. Wniesienia sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie Administratora.
6. Wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (UODO).

---

## 6. Bezpieczeństwo danych
- Hasła użytkowników przechowywane są wyłącznie w formie jednokierunkowych skrótów kryptograficznych.
- Sejf kartoteki chroniony jest osobnym hasłem, kodem PIN oraz opcjonalnie weryfikacją dwuetapową (TOTP).
- Komunikacja z serwerami odbywa się wyłącznie przez szyfrowany protokół HTTPS/TLS.
