import type { CSSProperties } from 'react';
import type { DocumentRecord, Tag } from '../types/domain';

function activeTags(doc: Pick<DocumentRecord, 'tags'>): Tag[] {
  return (doc.tags || []).map((entry) => entry.tag).filter((tag): tag is Tag => Boolean(tag));
}

function isHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

function contrastTextColor(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 160 ? '#0f172a' : '#ffffff';
}

/** Returns subtle tile border and background tint based on the document's primary tag. */
export function getTagTileStyle(doc: Pick<DocumentRecord, 'tags'>, checked: boolean): CSSProperties | undefined {
  const primary = activeTags(doc)[0];
  if (!primary || !isHexColor(primary.color)) return undefined;
  return checked
    ? { backgroundColor: `${primary.color}24` }
    : { borderColor: `${primary.color}99`, backgroundColor: `${primary.color}18` };
}

type Props = {
  document: Pick<DocumentRecord, 'tags'>;
  hideThreeDots: boolean;
};

/** Renders document tag pills in the top-right corner of a tile without overlapping the menu button. */
export default function DocumentTagCorner({ document, hideThreeDots }: Props) {
  const tags = activeTags(document);
  if (tags.length === 0) return null;
  const visible = tags.slice(0, 2);
  const extra = tags.length - visible.length;
  return (
    <div className={`pointer-events-none absolute top-2 z-10 flex max-w-[62%] flex-wrap justify-end gap-1 ${hideThreeDots ? 'right-2.5' : 'right-8'}`}>
      {visible.map((tag) => {
        const hex = isHexColor(tag.color) ? tag.color : '#3b82f6';
        return (
          <span
            key={tag.id}
            title={tag.name}
            style={{ backgroundColor: hex, borderColor: hex, color: contrastTextColor(hex) }}
            className="inline-flex max-w-[96px] items-center justify-center truncate rounded-full border px-2 py-0.5 text-center text-[10px] font-bold leading-tight shadow-sm"
          >
            {tag.name}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center rounded-full border border-slate-600 bg-slate-800/90 px-2 py-0.5 text-[10px] font-bold leading-tight text-slate-200">
          +{extra}
        </span>
      )}
    </div>
  );
}
