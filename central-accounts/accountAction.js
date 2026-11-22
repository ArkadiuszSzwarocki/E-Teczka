"use strict";
(() => {
  const code = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const message = document.getElementById('message'), form = document.getElementById('form');
  const verifying = location.pathname === '/verify';
  const title = document.getElementById('title'), button = document.getElementById('submit');
  const password = document.getElementById('password'), confirmation = document.getElementById('confirmation');
  const receiptKey = 'mojateczka_email_verified';
  let busy = false;
  function success() {
    form.hidden = true; password.value = ''; confirmation.value = '';
    title.textContent = verifying ? 'Adres e-mail potwierdzony!' : 'Hasło zostało zmienione';
    message.textContent = verifying ? 'Twoje konto jest aktywne.' : 'Nowe hasło zostało zapisane.';
    document.getElementById('hint').textContent = 'Wróć do otwartego okna aplikacji MojaTeczka i zaloguj się. Możesz zamknąć tę kartę.';
    if (verifying) sessionStorage.setItem(receiptKey, 'yes');
  }
  if (!verifying) {
    title.textContent = 'Ustaw nowe hasło';
    document.getElementById('hint').textContent = 'Wybierz nowe hasło zawierające co najmniej 8 znaków. Zmiana wyloguje dotychczasowe sesje konta centralnego.';
    document.getElementById('passwordFields').hidden = false;
    password.required = true; confirmation.required = true;
    button.textContent = 'Zapisz nowe hasło';
  }
  if (!code && verifying && sessionStorage.getItem(receiptKey) === 'yes') { success(); return; }
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) {
    title.textContent = 'Nieprawidłowy link';
    message.textContent = 'Otwórz ponownie pełny link z wiadomości e-mail.';
    document.getElementById('hint').hidden = true; return;
  }
  if (verifying) sessionStorage.removeItem(receiptKey);
  async function submit() {
    if (busy) return;
    if (!verifying && password.value !== confirmation.value) { message.textContent = 'Hasła muszą być takie same.'; return; }
    busy = true; button.disabled = true;
    if (verifying) { title.textContent = 'Potwierdzanie adresu…'; message.textContent = 'Trwa aktywacja konta. Poczekaj chwilę.'; form.hidden = true; }
    try {
      const response = await fetch(verifying ? '/verify-email' : '/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: code, ...(!verifying ? { password: password.value } : {}) }), redirect: 'error' });
      const payload = await response.json();
      if (response.ok) success();
      else {
        title.textContent = verifying ? 'Nie udało się potwierdzić adresu' : 'Ustaw nowe hasło';
        message.textContent = payload.error || 'Link jest nieprawidłowy lub wygasł.';
        if (verifying) document.getElementById('hint').textContent = 'Jeśli link wygasł, poproś o nową wiadomość potwierdzającą.';
      }
    } catch {
      message.textContent = 'Nie udało się połączyć. Spróbuj ponownie.';
      if (verifying) { title.textContent = 'Błąd połączenia'; button.textContent = 'Spróbuj ponownie'; form.hidden = false; }
    } finally { busy = false; button.disabled = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
  if (verifying) void submit();
  else { message.textContent = 'Wpisz nowe hasło do swojego konta.'; form.hidden = false; }
})();
