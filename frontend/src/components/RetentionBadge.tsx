import type { DocumentRecord } from '../types/domain';
import { formatRetentionSummary } from '../utils/documentLifecycle';

type Props = {
  document: Pick<DocumentRecord, 'createdAt' | 'retentionEnabled' | 'retentionUnit' | 'retentionValue'>;
  className?: string;
};

/** Compact badge displaying remaining document retention or indefinite status. */
export default function RetentionBadge({ document, className = '' }: Props) {
  const summary = formatRetentionSummary(document);
  const tone = summary.expired
    ? 'bg-red-950/60 text-red-300 border-red-700/40'
    : summary.indefinite
      ? 'bg-slate-800/80 text-slate-300 border-slate-600/50'
      : 'bg-sky-950/50 text-sky-300 border-sky-700/40';
  return (
    <span title={summary.title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone} ${className}`}>
      ⏱ {summary.label}
    </span>
  );
}
