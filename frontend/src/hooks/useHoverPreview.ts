import { useRef, useState } from 'react';

/** Manages delayed hover preview state for document cards and rows. */
export function useHoverPreview() {
  const [hoverDocId, setHoverDocId] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const hoverOpenTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const handleHoverEnter = (id: number) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    if (hoverOpenTimeoutRef.current) clearTimeout(hoverOpenTimeoutRef.current);
    if (hoverDocId === id) return;
    hoverOpenTimeoutRef.current = setTimeout(() => {
      hoverOpenTimeoutRef.current = null;
      setHoverDocId(id);
    }, 500);
  };

  const handleHoverLeave = () => {
    if (hoverOpenTimeoutRef.current) {
      clearTimeout(hoverOpenTimeoutRef.current);
      hoverOpenTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverDocId(null);
    }, 300);
  };

  return {
    hoverDocId,
    setHoverDocId,
    hoverAnchor,
    setHoverAnchor,
    handleHoverEnter,
    handleHoverLeave,
  };
}
