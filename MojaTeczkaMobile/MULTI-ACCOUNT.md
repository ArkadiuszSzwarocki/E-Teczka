# Konta na jednym telefonie

Telefon pozwala logować się na różne konta. Przycisk „Zmień konto — zachowaj sejf”
znajduje się przy zablokowanym sejfie i w ustawieniach konta. Zapisane adresy są
wyłącznie podpowiedziami: przełączenie wymaga uwierzytelnienia nowego konta.
Nowy profil konfiguruje własny PIN/hasło/wzór/biometrię i paruje swój komputer.
Powrót do poprzedniego konta przywraca jego sejf oraz kolejkę bez przenoszenia plików.

`mobileProfile.ts` wybiera przestrzeń nazw przed wyświetleniem dokumentów.
Historyczny właściciel `eteczka.mobile.vault-owner` zachowuje dotychczasowe klucze
i katalogi. Pozostałe konta korzystają z oddzielnych katalogów, kluczy SecureStore,
PIN-ów, liczników prób, ustawień blokady, szkiców, list offline i kolejek synchronizacji.
Pamięć podręczna podglądu i połączenie z komputerem również są osobne.
Zmiana profilu czeka na zakończenie operacji starego profilu i blokuje nowe operacje
w czasie przejścia. Powiadomienia starego konta są anulowane przy zmianie konta.
Zadanie synchronizacji bez interfejsu wybiera profil wyłącznie z ważnej sesji.

Zmiana konta nie usuwa dokumentów, nie zeruje centralnych liczników ani nie usuwa
zaufania urządzenia w planie. Każde konto nadal podlega własnym limitom centralnym.
