function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(first.year, first.month - 1, first.day, first.hour, first.minute, first.second) - guess;
  const candidate = guess - offset;
  const second = zonedParts(new Date(candidate), timeZone);
  const correction = Date.UTC(year, month - 1, day, hour, minute, 0) -
    Date.UTC(second.year, second.month - 1, second.day, second.hour, second.minute, second.second);
  return new Date(candidate + correction);
}

export function nextDailyExecution(
  schedule = '08:00',
  requestedTimeZone = 'America/Bahia',
  now = new Date(),
): string {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(schedule);
  const hour = match ? Math.min(23, Number(match[1])) : 8;
  const minute = match ? Math.min(59, Number(match[2])) : 0;
  let timeZone = requestedTimeZone;
  try { zonedParts(now, timeZone); } catch { timeZone = 'America/Bahia'; }

  const today = zonedParts(now, timeZone);
  let candidate = localTimeToUtc(today.year, today.month, today.day, hour, minute, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    candidate = localTimeToUtc(
      tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(),
      hour, minute, timeZone,
    );
  }
  return candidate.toISOString();
}
