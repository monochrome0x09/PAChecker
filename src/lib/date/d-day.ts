const MILLISECONDS_PER_DAY = 86_400_000;

export function getLocalDateKey(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function formatDateLabel(value: string): string {
  const date = parseDateKey(value);
  if (!date) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

export function getDday(assessmentDate: string, now = new Date()): number | null {
  const target = parseDateKey(assessmentDate);
  if (!target) return null;
  const today = parseDateKey(getLocalDateKey(now));
  if (!today) return null;
  return Math.round((target.getTime() - today.getTime()) / MILLISECONDS_PER_DAY);
}

export function formatDday(days: number | null): string {
  if (days === null) return "날짜 확인 필요";
  if (days === 0) return "D-Day";
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}
