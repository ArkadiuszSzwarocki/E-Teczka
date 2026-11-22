'use strict';
(() => {
  const status = document.getElementById('status'), credentials = document.getElementById('credentials');
  const email = document.getElementById('email'), password = document.getElementById('password');
  const logout = document.getElementById('logout'), form = document.getElementById('form');
  const storageKey = 'eteczka_central_session';
  const googleOnly = new URLSearchParams(location.search || '').get('login') === 'google';
  const securityConfirmation = new URLSearchParams(location.search || '').get('purpose') === 'security';
  if (googleOnly) {
    document.getElementById('passwordCredentials').hidden = true;
    document.getElementById('googleIntro').hidden = false;
  }
  const googleLinkSection = document.getElementById('googleLinkSection'); let googleWebClientId = '';
  let turnstileSiteKey = ''; let turnstileToken = ''; let turnstileWidgetId = null;
  const handoffKey = 'eteczka_central_handoff';
  let handoffId = location.hash.slice(1) || sessionStorage.getItem(handoffKey) || ''; history.replaceState(null, '', location.pathname + (googleOnly ? '?login=google' + (securityConfirmation ? '&purpose=security' : '') : ''));
  if (!/^[A-Za-z0-9_-]{43}$/.test(handoffId)) handoffId = '';
  if (handoffId) sessionStorage.setItem(handoffKey, handoffId);
  const signedInNext = document.getElementById('signedInNext'), nextMessage = document.getElementById('nextMessage');
  const handoff = document.getElementById('handoff'), handoffInfo = document.getElementById('handoffInfo'), approveHandoff = document.getElementById('approveHandoff');
  async function loadDevices(){
    if(googleOnly)return;const response=await fetch('/devices',{headers:{authorization:`Bearer ${sessionStorage.getItem(storageKey)}`},redirect:'error'});if(!response.ok)return;const data=await response.json();document.getElementById('deviceSection').hidden=false;document.getElementById('devicePlan').textContent=`Plan: ${{free:'Darmowy',standard:'Standard',premium:'Premium'}[data.plan]||data.plan}`;const list=document.getElementById('deviceList');list.replaceChildren();for(const device of data.devices){const row=document.createElement('div');const label=document.createElement('p');label.textContent=`${device.name} (${device.kind==='desktop'?'komputer':'urządzenie mobilne'})`;const button=document.createElement('button');button.type='button';button.textContent='Usuń zaufanie urządzenia';button.addEventListener('click',()=>void execute(async()=>{button.disabled=true;await request('/devices/revoke',{deviceId:device.device_id},sessionStorage.getItem(storageKey));await loadDevices();}));row.append(label,button);list.append(row);}
  }
  async function request(path, body, bearer) {
    const headers = { 'content-type': 'application/json' }; if (bearer) headers.authorization = `Bearer ${bearer}`;
    const payload = turnstileSiteKey && turnstileToken && ['/login', '/register', '/resend-verification', '/request-password-reset'].includes(path)
      ? { ...body, turnstileToken }
      : body;
    const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error' });
    const data = response.status === 204 ? {} : await response.json();
    if (turnstileWidgetId !== null && window.turnstile?.reset) { window.turnstile.reset(turnstileWidgetId); turnstileToken = ''; }
    if (!response.ok) {
      if (data.code === 'ACCOUNT_LINK_REQUIRED') {
        document.getElementById('passwordCredentials').hidden = false;
        document.getElementById('googleIntro').textContent = 'Masz już konto MojejTeczki z tym adresem. Zaloguj się jego hasłem. Następnie wybierz „Połącz z kontem Google”, aby kolejne logowania działały przez Google.';
        document.getElementById('googleIntro').hidden = false;
      }
      throw new Error(data.error || 'Operacja nie powiodła się.');
    } return data;
  }
  function showUser(user) { void loadDevices().catch(()=>undefined); signedInNext.hidden = false; nextMessage.textContent = handoffId ? 'Porównaj kod poniżej z kodem w aplikacji i potwierdź logowanie urządzenia. Następnie wróć do aplikacji, aby kontynuować.' : 'Jesteś zalogowany na stronie konta. Aby otworzyć dokumenty, przejdź do okna aplikacji MojaTeczka i wpisz tam e-mail oraz hasło w zakładce „Zaloguj się”. Logowanie e-mailem w aplikacji nie wymaga porównywania kodu.'; status.textContent = `Zalogowano: ${user.email}`; credentials.hidden = true; logout.hidden = false; googleLinkSection.hidden = !googleWebClientId; password.value = ''; approveHandoff.disabled = !handoffId; }
  async function execute(operation) { try { await operation(); } catch (error) { status.textContent = error.message || 'Błąd połączenia.'; } }
  form.addEventListener('submit', event => { event.preventDefault(); void execute(async () => { const result = await request('/login', { email: email.value, password: password.value }); sessionStorage.setItem(storageKey, result.token); showUser(result.user); }); });
  document.getElementById('register').addEventListener('click', () => void execute(async () => { const result = await request('/register', { email: email.value, password: password.value }); status.textContent = result.message; password.value = ''; }));
  document.getElementById('resend').addEventListener('click', () => void execute(async () => { status.textContent = (await request('/resend-verification', { email: email.value })).message; }));
  document.getElementById('reset').addEventListener('click', () => void execute(async () => { status.textContent = (await request('/request-password-reset', { email: email.value })).message; }));
  logout.addEventListener('click', () => void execute(async () => { await request('/logout', {}, sessionStorage.getItem(storageKey)); sessionStorage.removeItem(storageKey); signedInNext.hidden = true; document.getElementById('deviceSection').hidden=true; status.textContent = 'Wylogowano.'; credentials.hidden = false; logout.hidden = true; googleLinkSection.hidden = true; document.getElementById('googleLink').replaceChildren(); approveHandoff.disabled = true; await setupGoogle('google', false); }));
  if (handoffId) void execute(async () => { try { const item = await request('/handoff/inspect', { requestId: handoffId }); handoffInfo.textContent = `Urządzenie: ${item.deviceName}. Kod: ${item.displayCode}`; handoff.hidden = googleOnly; } catch (error) { handoffId = ''; sessionStorage.removeItem(handoffKey); approveHandoff.disabled = true; nextMessage.textContent = 'Żądanie logowania wygasło. Wróć do aplikacji i wybierz ponownie „Otwórz logowanie”.'; throw error; } });
  approveHandoff.addEventListener('click', () => void execute(async () => { approveHandoff.disabled = true; try { await request('/handoff/approve', { requestId: handoffId }, sessionStorage.getItem(storageKey)); handoffId = ''; sessionStorage.removeItem(handoffKey); handoff.hidden = true; nextMessage.textContent = 'Gotowe. Otwarta aplikacja MojaTeczka automatycznie dokończy logowanie. Możesz wrócić do jej okna.'; status.textContent = 'Logowanie urządzenia potwierdzone.'; } catch (error) { approveHandoff.disabled = false; throw error; } }));
  async function setupGoogle(targetId, linking) {
    if (!googleWebClientId || !window.google?.accounts?.id) return;
    const { nonce } = await request('/google-challenge', {});
    window.google.accounts.id.initialize({ client_id: googleWebClientId, nonce, auto_select: false, callback: response => void execute(async () => {
      try {
        if (linking) { await request('/link-google', { credential: response.credential, nonce }, sessionStorage.getItem(storageKey)); status.textContent = 'Konto Google zostało połączone.'; }
        else {
          const result = await request('/google', { credential: response.credential, nonce });
          sessionStorage.setItem(storageKey, result.token);
          showUser(result.user);
          if (googleOnly) {
            if (!handoffId) throw new Error('Logowanie do aplikacji wygasło. Rozpocznij je ponownie w MojejTeczce.');
            await request('/handoff/approve', { requestId: handoffId }, result.token);
            handoffId = ''; sessionStorage.removeItem(handoffKey);
            handoff.hidden = true; credentials.hidden = true; googleLinkSection.hidden = true; logout.hidden = true;
            status.textContent = `Zalogowano przez Google: ${result.user.email}`;
            document.getElementById('accountTitle').textContent = 'Wszystko gotowe';
            document.getElementById('nextTitle').hidden = true;
            document.getElementById('handoffFootnote').hidden = true;
            nextMessage.textContent = 'Możesz zamknąć tę kartę. Aplikacja MojaTeczka automatycznie dokończy logowanie i otworzy Twoje dokumenty.';
            if (securityConfirmation) nextMessage.textContent = 'Tożsamość potwierdzona. Możesz zamknąć tę kartę i wrócić do ustawień MojejTeczki.';
            signedInNext.hidden = false;
          }
        }
      } finally { document.getElementById(targetId).replaceChildren(); if (!linking) await setupGoogle(targetId, false); }
    }) });
    window.google.accounts.id.renderButton(document.getElementById(targetId), { type: 'standard', theme: 'filled_black', shape: 'pill', size: 'large', text: 'continue_with', width: Math.min(320, Math.max(200, (window.innerWidth || 424) - 104)) });
  }
  document.getElementById('showGoogleLink').addEventListener('click', () => void execute(async () => { document.getElementById('googleLink').replaceChildren(); await setupGoogle('googleLink', true); }));
  void fetch('/public-config').then(response => response.json()).then(async config => {
    if (config.appUrl) { try { const target = new URL(config.appUrl); if ((target.protocol === 'https:' || (target.protocol === 'http:' && target.hostname === '127.0.0.1')) && !target.username && !target.password) { const link = document.getElementById('returnToApp'); link.href = target.href; link.hidden = false; } } catch { /* no configured application link */ } }
    turnstileSiteKey = config.turnstileSiteKey || '';
    if (turnstileSiteKey) {
      await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
      if (window.turnstile?.render) {
        turnstileWidgetId = window.turnstile.render('#turnstile', { sitekey: turnstileSiteKey, callback: token => { turnstileToken = token; }, 'expired-callback': () => { turnstileToken = ''; } });
      }
    }
    googleWebClientId = config.googleWebClientId || ''; if (!googleWebClientId) return;
    await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
    if (!logout.hidden) googleLinkSection.hidden = false;
    await setupGoogle('google', false);
  }).catch(() => { status.textContent = 'Logowanie Google jest chwilowo niedostępne.'; });
  const saved = sessionStorage.getItem(storageKey);
  if (saved && !googleOnly) void fetch('/me', { headers: { authorization: `Bearer ${saved}` } }).then(response => response.ok ? response.json() : Promise.reject()).then(showUser).catch(() => sessionStorage.removeItem(storageKey));
})();
