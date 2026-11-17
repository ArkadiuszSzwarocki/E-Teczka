import { useFamilyGroup } from '../hooks/useFamilyGroup';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  currentUserEmail: string | null;
  onChanged: () => void;
  onClose: () => void;
};

/** Modal for managing Family plan invitations, active members, and shared workspace access. */
export default function FamilySettingsModal({ apiUrl, fetcher, currentUserEmail, onChanged, onClose }: Props) {
  const family = useFamilyGroup(apiUrl, fetcher, onChanged);
  const group = family.overview?.group ?? null;
  const incoming = family.overview?.incomingInvites ?? [];

  return (
    <div className="fixed inset-0 z-[115] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="family-modal-title" className="mx-auto my-6 w-full max-w-2xl rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 pb-4">
          <div>
            <h2 id="family-modal-title" className="text-xl font-bold text-white">Rodzina i wspólne dokumenty</h2>
            <p className="mt-1 text-xs text-slate-400">
              Każda osoba loguje się na własne konto. Wspólne są kartoteki i dokumenty, natomiast Sejf każdego użytkownika pozostaje prywatny.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        {family.loading ? (
          <p className="py-6 text-sm text-slate-400">Ładowanie danych grupy rodzinnej…</p>
        ) : (
          <div className="mt-5 space-y-5">
            {incoming.length > 0 && !group && (
              <section className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-4">
                <h3 className="text-sm font-bold text-emerald-300">Oczekujące zaproszenia dla Ciebie</h3>
                <div className="mt-3 space-y-2">
                  {incoming.map(item => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm">
                      <div>
                        <p className="font-semibold text-white">Od: {item.hostName || item.hostEmail}</p>
                        <p className="text-xs text-slate-400">{item.hostEmail} · kod: <span className="font-mono text-emerald-300">{item.code}</span></p>
                      </div>
                      <button type="button" disabled={family.busy} onClick={() => void family.acceptInvite(item.code)} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50">
                        Akceptuj zaproszenie
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {(!group || group.role === 'host') && (
              <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <h3 className="text-sm font-bold text-white">Zaproś domownika (wymagany plan Rodzinny)</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={family.inviteEmail}
                    onChange={e => family.setInviteEmail(e.target.value)}
                    placeholder="Adres e-mail domownika"
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  />
                  <button type="button" disabled={family.busy || !family.inviteEmail.trim()} onClick={() => void family.sendInvite()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                    Wyślij zaproszenie
                  </button>
                </div>
              </section>
            )}

            {!group && (
              <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <h3 className="text-sm font-bold text-white">Masz kod zaproszenia od gospodarza?</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={family.inviteCode}
                    onChange={e => family.setInviteCode(e.target.value)}
                    placeholder="Wpisz kod (np. A1B2C3D4E5)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 font-mono text-sm uppercase text-white focus:border-blue-500 focus:outline-none"
                  />
                  <button type="button" disabled={family.busy || !family.inviteCode.trim()} onClick={() => void family.acceptInvite()} className="rounded-lg border border-emerald-500/60 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
                    Dołącz
                  </button>
                </div>
              </section>
            )}

            {group && (
              <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Członkowie rodziny ({group.members.length} / {group.maxMembers})</h3>
                </div>
                <div className="mt-3 space-y-2">
                  {group.members.map(member => (
                    <div key={member.userId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                      <div>
                        <p className="font-semibold text-white">
                          {member.name || member.email}{' '}
                          <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-blue-300">
                            {member.role === 'host' ? 'Gospodarz' : 'Domownik'}
                          </span>
                        </p>
                        <p className="text-xs text-slate-400">{member.email}</p>
                      </div>
                      {(group.role === 'host' && member.role !== 'host') || (group.role === 'member' && member.email.toLowerCase() === currentUserEmail?.toLowerCase()) ? (
                        <button type="button" disabled={family.busy} onClick={() => void family.removeMember(member.userId)} className="rounded border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                          {member.email.toLowerCase() === currentUserEmail?.toLowerCase() ? 'Opuść rodzinę' : 'Usuń'}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {group.pendingInvites.length > 0 && (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <p className="text-xs font-semibold text-slate-400">Oczekujące zaproszenia:</p>
                    <div className="mt-2 space-y-1.5">
                      {group.pendingInvites.map(inv => (
                        <div key={inv.id} className="flex items-center justify-between gap-2 rounded bg-slate-950/50 px-3 py-1.5 text-xs">
                          <span>{inv.email} · kod: <strong className="font-mono text-amber-300">{inv.code}</strong></span>
                          <button type="button" disabled={family.busy} onClick={() => void family.cancelInvite(inv.id)} className="text-red-300 hover:underline">Anuluj</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {family.info && <p role="status" className="text-sm text-emerald-300">{family.info}</p>}
            {family.error && <p role="status" className="text-sm text-red-300">{family.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
