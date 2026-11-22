import { useState } from 'react';

type TemplateId = 'home' | 'business';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  onApplied: (createdCount: number, label: string) => Promise<void> | void;
  onDismiss: () => void;
};

const TEMPLATES: Array<{ id: TemplateId; icon: string; title: string; subtitle: string; folders: string[] }> = [
  {
    id: 'home',
    icon: '🏠',
    title: 'Dom i Rodzina',
    subtitle: 'Gotowy porządek na codzienne rachunki, polisy, zdrowie i gwarancje.',
    folders: ['Auto', 'Zdrowie', 'Rachunki', 'Gwarancje', 'Umowy'],
  },
  {
    id: 'business',
    icon: '💼',
    title: 'Firma JDG',
    subtitle: 'Struktura pod faktury KSeF, rozliczenia z księgowością i środki trwałe.',
    folders: ['KSeF Koszty', 'KSeF Sprzedaż', 'ZUS i US', 'Umowy', 'Środki trwałe'],
  },
];

/** Quick-start profile picker shown when a workspace has no folders yet. */
export default function FolderTemplateOnboardingModal({ apiUrl, fetcher, onApplied, onDismiss }: Props) {
  const [busyId, setBusyId] = useState<TemplateId | null>(null);
  const [error, setError] = useState('');

  const apply = async (template: (typeof TEMPLATES)[number]) => {
    setBusyId(template.id);
    setError('');
    try {
      const response = await fetcher(`${apiUrl}/api/folders/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id }),
      });
      const payload = await response.json().catch(() => ({})) as { createdCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Nie udało się utworzyć szablonu kartotek.');
      await onApplied(payload.createdCount ?? 0, template.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć szablonu kartotek.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mx-auto my-6 max-w-3xl rounded-2xl border border-blue-500/35 bg-[#111c33]/90 p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-blue-400">Szybki start</p>
          <h3 className="mt-1 text-xl font-bold text-white">Wybierz gotowy układ kartotek</h3>
          <p className="mt-1 text-sm text-slate-300">
            Zamiast zaczynać od pustego ekranu, utwórz jednym kliknięciem sprawdzone kartoteki i podkartoteki. Możesz je później dowolnie zmieniać.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-800 hover:text-white">
          Pomiń
        </button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-xs text-red-200">{error}</p>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {TEMPLATES.map(tpl => (
          <div key={tpl.id} className="flex flex-col justify-between rounded-xl border border-slate-700 bg-[#0f172a]/90 p-4 transition hover:border-blue-400/60">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{tpl.icon}</span>
                <h4 className="text-base font-bold text-white">{tpl.title}</h4>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{tpl.subtitle}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tpl.folders.map(name => (
                  <span key={name} className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                    📁 {name}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void apply(tpl)}
              className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busyId === tpl.id ? 'Tworzenie kartotek…' : `Użyj szablonu „${tpl.title}”`}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
