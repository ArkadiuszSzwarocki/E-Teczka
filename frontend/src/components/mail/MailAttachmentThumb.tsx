import { useEffect, useState } from 'react';
import type { MailItem } from '../../types/mailInbox';

type Props = {
  item: MailItem;
  apiUrl: string;
  fetcher: typeof fetch;
  onClick: () => void;
};

/** Renders an image thumbnail or document icon button for a staged mail attachment. */
export function MailAttachmentThumb({ item, apiUrl, fetcher, onClick }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string>('');
  const isImage = item.mimeType.startsWith('image/') || /\.(png|jpe?g)$/i.test(item.filename);

  useEffect(() => {
    if (!isImage || item.locked) return;
    let active = true;
    let objectUrl = '';
    void fetcher(`${apiUrl}/api/mail-inbox/items/${item.id}/file`)
      .then(async res => (res.ok ? res.blob() : null))
      .then(blob => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiUrl, fetcher, isImage, item.id, item.locked]);

  return (
    <button
      type="button"
      disabled={Boolean(item.locked)}
      onClick={onClick}
      title={item.locked ? 'Poza limitem planu — przejdź na Standard lub Premium, aby odblokować podgląd' : 'Kliknij, aby powiększyć podgląd'}
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-600 bg-[#0f172a] hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {item.locked ? (
        <span className="text-xl" aria-hidden="true">🔒</span>
      ) : isImage && thumbUrl ? (
        <img src={thumbUrl} alt={item.filename} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xl" aria-hidden="true">{isImage ? '🖼️' : '📄'}</span>
      )}
    </button>
  );
}
