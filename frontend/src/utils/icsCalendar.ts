export type CalendarDeadlineEvent = {
  uid: string;
  title: string;
  date: Date;
  description?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

function formatIcsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Generates a standard RFC 5545 .ics calendar file compatible with Google Calendar and Apple Calendar. */
export function buildIcsContent(events: CalendarDeadlineEvent[]): string {
  const stamp = `${formatIcsDate(new Date())}T000000Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MojaTeczka//Kalendarz Waznosci//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const ev of events) {
    const start = formatIcsDate(ev.date);
    const nextDay = new Date(ev.date.getTime() + 86_400_000);
    const end = formatIcsDate(nextDay);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}@mojateczka.pl`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcsText(ev.title)}`,
      `DESCRIPTION:${escapeIcsText(ev.description || 'Termin z aplikacji MojaTeczka')}`,
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Za 7 dni: ${escapeIcsText(ev.title)}`,
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Jutro: ${escapeIcsText(ev.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadIcsFile(filename: string, events: CalendarDeadlineEvent[]): void {
  const content = buildIcsContent(events);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
