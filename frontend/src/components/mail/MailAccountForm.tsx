import { useEffect, useState } from 'react';
import { detectImapPreset } from '../../services/imapPresets';
import type { MailAccountFormValues, MailAccountPublic } from '../../types/mailInbox';
import { MailImapHelpPanel } from './MailImapHelpPanel';

type Props = {
  editingAccount: MailAccountPublic | null;
  onSubmit: (values: MailAccountFormValues) => Promise<void>;
  onTest?: (values: MailAccountFormValues) => Promise<{ ok: boolean; message: string }>;
};

/** Form for adding or editing an IMAP mailbox configuration with automatic provider presets and connection testing. */
export function MailAccountForm({ editingAccount, onSubmit, onTest }: Props) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [mailbox, setMailbox] = useState('INBOX');
  const [presetNote, setPresetNote] = useState('');
  const [manualHostEdited, setManualHostEdited] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setTestResult(null);
    if (editingAccount) {
      setUser(editingAccount.user);
      setPassword('');
      setHost(editingAccount.host);
      setPort(String(editingAccount.port));
      setSecure(editingAccount.secure);
      setMailbox(editingAccount.mailbox || 'INBOX');
      setManualHostEdited(true);
      setPresetNote('');
    } else {
      setUser('');
      setPassword('');
      setHost('');
      setPort('993');
      setSecure(true);
      setMailbox('INBOX');
      setManualHostEdited(false);
      setPresetNote('');
    }
  }, [editingAccount]);

  const handleEmailChange = (nextEmail: string) => {
    setUser(nextEmail);
    const preset = detectImapPreset(nextEmail);
    if (preset) {
      if (!manualHostEdited || !host.trim()) {
        setHost(preset.host);
        setPort(String(preset.port));
        setSecure(preset.secure);
      }
      setPresetNote(preset.note || '');
    } else {
      setPresetNote('');
    }
  };

  const handleTest = async () => {
    if (!onTest) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTest({
        id: editingAccount?.id,
        host,
        port: Number(port),
        secure,
        user,
        password,
        mailbox,
      });
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  return (
    <form
      onChange={() => { if (testResult) setTestResult(null); }}
      onSubmit={e => {
        e.preventDefault();
        void onSubmit({
          id: editingAccount?.id,
          host,
          port: Number(port),
          secure,
          user,
          password,
          mailbox,
        });
      }}
      className="space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input
          value={user}
          onChange={e => handleEmailChange(e.target.value)}
          placeholder="Adres e-mail / login (np. jan@gmail.com)"
          className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white"
          required
        />
        <input
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={editingAccount ? 'Nowe hasło (zostaw puste, aby zachować)' : 'Hasło lub hasło aplikacji'}
          type="password"
          className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white"
          required={!editingAccount}
        />
        <input
          value={host}
          onChange={e => { setHost(e.target.value); setManualHostEdited(true); }}
          placeholder="Serwer IMAP (uzupełni się automatycznie)"
          className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white"
          required
        />
        <input
          value={port}
          onChange={e => setPort(e.target.value)}
          placeholder="Port (993)"
          type="number"
          className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white"
          required
        />
        <input
          value={mailbox}
          onChange={e => setMailbox(e.target.value)}
          placeholder="Folder (INBOX)"
          className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-sm text-white"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={secure} onChange={e => setSecure(e.target.checked)} className="accent-cyan-500" /> SSL/TLS
          </label>
          <div className="flex items-center gap-2">
            {onTest && (
              <button
                type="button"
                disabled={testing || !host.trim() || !user.trim() || (!password && !editingAccount)}
                onClick={() => void handleTest()}
                className="rounded-lg border border-cyan-500/60 bg-cyan-950/50 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/60 disabled:opacity-40"
              >
                {testing ? '⏳ Testuję…' : '🔌 Testuj połączenie'}
              </button>
            )}
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Zapisz IMAP
            </button>
          </div>
        </div>
      </div>
      {testResult && (
        <div role="status" className={`rounded-lg border px-3 py-2 text-xs font-medium ${testResult.ok ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200' : 'border-rose-500/50 bg-rose-950/40 text-rose-200'}`}>
          {testResult.ok ? '✅ ' : '❌ '}
          {testResult.message}
        </div>
      )}
      {presetNote && <p className="text-xs text-cyan-300">ℹ️ {presetNote}</p>}
      <MailImapHelpPanel open={helpOpen} onToggle={() => setHelpOpen(v => !v)} />
    </form>
  );
}
