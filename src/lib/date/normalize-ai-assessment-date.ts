const SEOUL_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
});

function toDateKey(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function currentSeoulYear(now: Date): number {
  return Number(SEOUL_YEAR_FORMATTER.format(now));
}

export function normalizeAiAssessmentDate(
  value: unknown,
  now = new Date(),
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/[()（）]/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  // Accept ISO dates (including timestamps) and common Korean document formats.
  const fullDate = normalized.match(
    /^(\d{4})\s*(?:-|\/|\.|년)\s*(\d{1,2})\s*(?:-|\/|\.|월)\s*(\d{1,2})(?:\s*일)?(?:\s|\.|,|[월화수목금토일]요일|[월화수목금토일])*(?:T.*)?$/,
  );
  if (fullDate) {
    return toDateKey(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
  }

  const shortYearDate = normalized.match(
    /^(\d{2})\s*(?:-|\/|\.)\s*(\d{1,2})\s*(?:-|\/|\.)\s*(\d{1,2})(?:\s*일)?(?:\s|\.|,|[월화수목금토일]요일|[월화수목금토일])*$/,
  );
  if (shortYearDate) {
    return toDateKey(
      2000 + Number(shortYearDate[1]),
      Number(shortYearDate[2]),
      Number(shortYearDate[3]),
    );
  }

  // School notices often omit the year. Use the current Korean calendar year
  // while keeping final confirmation in the user's review form.
  const monthDay = normalized.match(
    /^(\d{1,2})\s*(?:-|\/|\.|월)\s*(\d{1,2})(?:\s*일)?(?:\s|\.|,|[월화수목금토일]요일|[월화수목금토일])*$/,
  );
  if (monthDay) {
    return toDateKey(
      currentSeoulYear(now),
      Number(monthDay[1]),
      Number(monthDay[2]),
    );
  }

  return null;
}
