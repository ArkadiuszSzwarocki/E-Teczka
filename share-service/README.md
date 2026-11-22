# Serwis linków — wersja testowa

Serwis jest oddzielony od bazy i plików E‑Teczki. Przyjmuje kopię dokumentu PDF/JPG/PNG, szyfruje ją AES‑256‑GCM i tworzy link, którego token znajduje się we fragmencie URL. Token i PIN nie są zapisywane jawnie. Dostęp wymaga tokenu, opcjonalnie sześciocyfrowego PIN-u; można ograniczyć go do jednego pobrania. Kopie wygasają i są okresowo usuwane. Jedna instancja serwisu jest wymagana: plikowa baza nie koordynuje równoczesnych zapisów między kontenerami.

## Status

To implementacja do testów, nie należy jej jeszcze wystawiać publicznie ani oferować jako gotowej usługi komercyjnej. Brakuje niezależnej, centralnej weryfikacji subskrypcji Premium: wspólny sekret wydawania linków w aplikacji użytkownika nie stanowi zabezpieczenia licencji. Potrzebny jest serwer kont i uprawnień, ograniczenia nadużyć i pojemności, odzyskiwanie po awarii, testy wdrożenia oraz przegląd bezpieczeństwa. Utrata klucza głównego uniemożliwia odczyt zapisanych kopii.

## Konfiguracja testowa

Plik `compose.example.yml` wymaga zmiennych `SHARE_PUBLIC_BASE` (publiczny adres HTTPS bez ścieżki), `SHARE_MASTER_KEY` (32 losowe bajty jako 64 znaki hex) i `SHARE_PUBLISH_SECRET` (32 losowe bajty jako base64url, 43 znaki). Sekret i klucz przechowuj poza repozytorium. Katalog `./data` musi być trwały i zapisywalny dla UID 1000 w kontenerze. Endpoint kontenera jest związany z `127.0.0.1`; potrzebny jest odpowiednio skonfigurowany reverse proxy HTTPS. Administrator powinien ograniczyć dostęp do `/admin/` na poziomie sieci/reverse proxy, ponieważ endpoint wydawania linków nie jest przeznaczony dla odbiorców.

W pliku `.env` zaplecza E‑Teczki ustaw `MOJATECZKA_SHARE_SERVICE_URL` na adres HTTPS usługi oraz `MOJATECZKA_SHARE_SERVICE_SECRET` na sekret wydawania. Nie używaj certyfikatu bez zaufanego łańcucha i nie wyłączaj walidacji TLS. Bez tej konfiguracji aplikacja jasno poinformuje, że usługa jest niedostępna.

Adres publiczny jest widoczny tylko w momencie utworzenia — zapisywany jest identyfikator pozwalający unieważnić link, nie sam token. W tej wersji lista unieważniania jest zapisana lokalnie i nie synchronizuje się między instalacjami; przy utracie bazy lokalnej należy usuwać linki przez administrację serwisu lub poczekać na wygaśnięcie.
