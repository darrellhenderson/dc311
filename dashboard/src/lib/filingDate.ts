/** Filing month key aligned with shard `_month` (UTC, matches Python build). */
export function filingMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Filing day key in UTC — matches shard month boundaries. */
export function filingDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Parse UTC timestamp stored on hydrated rows. */
export function parseUtcRowTimestamp(iso: string): Date {
  return new Date(iso.replace(' UTC', 'Z').replace(' ', 'T'));
}

/** Resolution calendar day in UTC for a closed request. */
export function resolutionDayKey(row: {
  is_closed: boolean;
  RESOLUTIONDATE: string | null;
  resolution_days: number | null;
  date: Date;
}): string | null {
  if (!row.is_closed) return null;
  if (row.RESOLUTIONDATE) {
    return filingDayKey(parseUtcRowTimestamp(row.RESOLUTIONDATE));
  }
  if (row.resolution_days !== null && row.resolution_days >= 0) {
    const resolved = new Date(row.date.getTime() + row.resolution_days * 86400000);
    return filingDayKey(resolved);
  }
  return null;
}

/** Calendar days in a filing month for chart axes. */
export function filingMonthDays(month: string): Array<{ key: string; label: string }> {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days: Array<{ key: string; label: string }> = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, mon - 1, day));
    days.push({
      key: filingDayKey(date),
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }

  return days;
}

/** Filing month plus follow-up days for cohort resolution charts. */
export const COHORT_FOLLOW_UP_DAYS = 120;

export function cohortChartDays(
  month: string,
  followUpDays = COHORT_FOLLOW_UP_DAYS,
): Array<{ key: string; label: string }> {
  const monthDays = filingMonthDays(month);
  if (monthDays.length === 0) return [];

  const [year, mon, day] = monthDays[monthDays.length - 1].key.split('-').map(Number);
  const days = [...monthDays];

  for (let offset = 1; offset <= followUpDays; offset += 1) {
    const date = new Date(Date.UTC(year, mon - 1, day + offset));
    days.push({
      key: filingDayKey(date),
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    });
  }

  return days;
}
