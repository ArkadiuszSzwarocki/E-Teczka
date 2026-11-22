import jsQR from 'jsqr';

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorInstance;

export type QrFrameDecoder = {
  mode: 'native' | 'jsqr';
  decode: (video: HTMLVideoElement) => Promise<string | null>;
};

const MAX_CANVAS_EDGE = 720;

/** Creates a QR frame decoder using native BarcodeDetector with an automatic jsQR canvas fallback for iOS Safari/Firefox. */
export function createQrFrameDecoder(): QrFrameDecoder {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Detector) {
    try {
      const detector = new Detector({ formats: ['qr_code'] });
      return {
        mode: 'native',
        decode: async (video) => {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
          const hits = await detector.detect(video);
          return hits[0]?.rawValue?.trim() || null;
        },
      };
    } catch {
      // Fall through to jsQR if native BarcodeDetector rejects qr_code format.
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  return {
    mode: 'jsqr',
    decode: async (video) => {
      if (!ctx || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;

      const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(vw, vh));
      const width = Math.max(1, Math.round(vw * scale));
      const height = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const result = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
      return result?.data?.trim() || null;
    },
  };
}
