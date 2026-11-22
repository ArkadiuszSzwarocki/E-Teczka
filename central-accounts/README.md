# Centralne konta — prace w toku

Ten katalog zawiera niezależny prototyp kont centralnych. Nie podłączaj go do publicznej trasy ani do danych produkcyjnych. Serwer uruchamia się wyłącznie na 127.0.0.1.

Istnieją: haszowanie haseł scrypt, potwierdzenie adresu i jego ponawianie, reset hasła unieważniający sesje, strona konta i strony obsługi linków, losowe sesje zapisywane jako skróty, jednorazowe wyzwania Google i weryfikacja tokenów przez bibliotekę Google oraz jawne łączenie kont po zalogowaniu. Moduły mają testy jednostkowe i test ścieżki HTTP.

Przed wdrożeniem trzeba co najmniej zweryfikować izolację sieci i konfigurację zaufanego konektora Cloudflare (jego stały adres IP i nagłówek klienta), uzupełnić ochronę przed botami, zapewnić bezpieczne zarządzanie sekretami oraz kopie bazy i ich odzyskiwanie, sprawdzić migrację rzeczywistych kont lokalnych, obsłużyć zakupy Google Play i przeprowadzić przegląd bezpieczeństwa. Połączenie desktopu z kontem centralnym jest przygotowane i testowane lokalnie, lecz nie zostało wdrożone ani sprawdzone z prawdziwym Google. Aktywny lokalny plan płatny blokuje przypisanie danych domyślnych do czasu opracowania migracji płatności.

W szczególności zresetowanie hasła centralnego unieważnia sesje centralne, ale nie unieważnia jeszcze wydanych wcześniej sesji lokalnych komputerów. Przed publicznym uruchomieniem trzeba zaprojektować i przetestować synchronizację ich unieważniania z zachowaniem wymaganej pracy offline. Nie wolno zakładać, że centralne wylogowanie natychmiast blokuje dostęp do kopii na innym urządzeniu.

`npm test` uruchamia testy lokalne. Testy Google korzystają z atrap; nie zastępują sprawdzenia z prawdziwym projektem Google OAuth. SQLite z `node:sqlite` jest eksperymentalne w używanym środowisku i wymaga decyzji przed wdrożeniem.

Mobilny ekran konta jest ukryty, dopóki nie ustawiono `EXPO_PUBLIC_CENTRAL_ACCOUNT_URL`; opcja Google dodatkowo wymaga `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, odpowiedniego klienta OAuth Android i przebudowania aplikacji z modułem natywnym. Nie testowano jeszcze działania na telefonie. Mobilna sesja centralna nadal nie jest powiązana z lokalnymi kartotekami, parowaniem urządzeń ani subskrypcją.


## Lokalne połączenie z aplikacją

Usługa kont korzysta teraz z MariaDB (`CENTRAL_MARIADB_*` w `.env`). Uruchomienie `npm start` lub `npm run dev:desktop` w katalogu głównym uruchamia również konta na porcie 3001. Backend wczytuje `backend/.env`; ustaw `MOJATECZKA_CENTRAL_ACCOUNT_URL=http://127.0.0.1:3001`. Lokalny link potwierdzenia wymaga `CENTRAL_VERIFY_URL=http://127.0.0.1:3001/verify` w `central-accounts/.env` oraz działającego SMTP. Po zmianie konfiguracji uruchom usługę ponownie.

Ekran startowy aplikacji zawiera rejestrację konta centralnego. Po potwierdzeniu adresu w wiadomości wróć do zakładki logowania. Logowanie otwiera przeglądarkę i wymaga porównania kodu urządzenia, a następnie jawnego połączenia z danymi lokalnymi lub utworzenia nowego konta lokalnego. Można też przejść od razu do dokumentów na komputerze.

HTTP dopuszczony jest wyłącznie dla adresu pętli zwrotnej `127.0.0.1`. Linki te działają na komputerze uruchamiającym aplikację; dla innych urządzeń i wdrożenia publicznego potrzebna jest rzeczywista domena HTTPS i odpowiednia konfiguracja usługi. Testy SQLite pozostają testami wcześniejszej implementacji; `node --test mariadb/*.test.js` sprawdza konfigurację i tworzenie schematu bez łączenia z bazą.
