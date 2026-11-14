# Plan audytu i weryfikacji E‑Teczki

1. Przeanalizować źródła, konfigurację, zależności i istniejące zmiany: desktop, backend, aplikacja mobilna i integracje.
2. Rozdzielić odpowiedzialności i poprawić wykryte błędy, zachowując zgodność danych i dotychczasowe funkcje.
3. Uruchomić kontrole typów, kompilacje i testy automatyczne; usunąć ujawnione usterki.
4. Powtórzyć kontrole po zmianach oraz uzupełnić testy istotnych zachowań.
5. W odizolowanym środowisku przetestować kartoteki i dokumenty: tworzenie, dodawanie, usuwanie, archiwizację i przywracanie.
6. Sprawdzić parowanie, online/offline, kolejkę i konflikty synchronizacji na komputerze i telefonie.
7. Sprawdzić płatności w trybie testowym, powrót z płatności, status oraz zdarzenia Stripe.
8. Zapisać wyniki, niewykonane scenariusze i ich przyczynę; nie używać produkcyjnych płatności ani nie usuwać dokumentów użytkownika.

## Stan wymagający uwagi

- 11.11.2026: Porównano schemat bazy użytkownika z modelem; brakowało tylko `SyncOperation`. Sprawdzono dodanie tabeli na kopii bazy i ponowny diff był pusty. Następnie wykonano kopię bezpieczeństwa `A:\ETeczkaTemp\eteczka-before-sync-repair-20261111.db`, dodano brakującą tabelę i uzgodniono historię dziewięciu migracji. `prisma migrate status` wskazuje aktualny schemat. `PRAGMA integrity_check` = `ok`; liczba użytkowników, kartotek i dokumentów odpowiada kopii (2, 12, 56). Historia migracji została oznaczona jako zastosowana dopiero po potwierdzeniu zgodności schematu; wcześniejsze migracje nie były ponownie wykonywane.
- `backend/prisma/schema.prisma` używa wpisanego na stałe `file:./eteczka.db`; ustawienie `DATABASE_URL` nie zmienia celu komend `prisma migrate resolve`. Do testów na kopii należy używać jawnego `--url` w komendach, które go wspierają, albo osobnego tymczasowego schematu.
- Przywracanie kopii zostało wydzielone do `services/restoreBackup.ts`. Testy potwierdzają walidację plików przed zmianą bazy i usuwanie zapisanych plików przy nieudanej transakcji. Eksport lokalny oraz ręczny i harmonogramowany eksport chmurowy przerywają pracę przy brakującym pliku źródłowym.
- Nadal do wykonania: pełne scenariusze online/offline na telefonie, obsługa pozostałych operacji kolejki, sprawdzenie płatności w piaskownicy oraz przywrócenia kopii po reinstalacji, kiedy lokalny sekret szyfrowania już nie istnieje.
