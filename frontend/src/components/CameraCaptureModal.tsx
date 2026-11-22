import { useEffect, useRef, useState } from 'react';

type Props = {
  onCapture: (dataUrl: string) => Promise<void> | void;
  onClose: () => void;
};

/** Requests browser camera permission and captures a document page via live video or native camera input fallback. */
export default function CameraCaptureModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Przeglądarka nie obsługuje podglądu na żywo. Użyj przycisku „Wybierz z aparatu” poniżej.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        if (active) setError('Brak zgody na użycie aparatu lub aparat jest niedostępny. Zezwól przeglądarce na dostęp do aparatu albo użyj przycisku poniżej.');
      }
    };
    void startCamera();
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, 1600 / video.videoWidth, 1600 / video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    onClose();
    void onCapture(dataUrl);
  };

  const handleFileCapture = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onClose();
        void onCapture(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 p-4">
      <section role="dialog" aria-modal="true" aria-label="Aparat telefonu" onClick={e => e.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-600 bg-[#0f172a] p-5 text-slate-200 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">📷 Skanuj aparatem</h3>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">{error}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-700 bg-black">
            <video ref={videoRef} playsInline muted className="max-h-[55vh] w-full object-contain" />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="cursor-pointer rounded-lg border border-slate-500 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">
            Wybierz z aparatu
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFileCapture(e.target.files?.[0])} />
          </label>
          {ready && (
            <button type="button" onClick={captureFrame} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">
              📸 Zrób zdjęcie strony
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">Anuluj</button>
        </div>
      </section>
    </div>
  );
}
