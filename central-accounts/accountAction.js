'use strict';
(() => {
  const code = location.hash.slice(1); history.replaceState(null, '', location.pathname);
  const message = document.getElementById('message'), form = document.getElementById('form');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) { message.textContent = 'Link jest nieprawidłowy.'; return; }
  const submit = async (endpoint, data) => {
    try {
      const result = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: code, ...data }), redirect: 'error' });
      const payload = await result.json(); message.textContent = result.ok ? payload.message : payload.error;
      return result.ok;
    } catch { message.textContent = 'Nie udało się połączyć. Spróbuj ponownie.'; return false; }
  };
  const verifying = location.pathname === '/verify';
  if (verifying) form.querySelector('button').textContent = 'Potwierdź i ustaw hasło';
  message.textContent = verifying ? 'Potwierdź adres i ustaw hasło do konta.' : 'Wpisz nowe hasło.'; form.hidden = false;
  form.addEventListener('submit', async event => { event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; if (await submit(verifying ? '/verify-email' : '/reset-password', { password: document.getElementById('password').value })) form.hidden = true; button.disabled = false; });
})();
