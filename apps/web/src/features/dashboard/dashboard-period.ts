const DAY = 86400000;
const cairoCalendar = new Intl.DateTimeFormat("en-CA-u-nu-latn", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type DashboardDays = { from: string; to: string };
export function cairoCalendarDay(date: Date) {
  const parts = cairoCalendar.formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function defaultDashboardDays(now = new Date()): DashboardDays {
  const to = cairoCalendarDay(now);
  return { from: `${to.slice(0, 7)}-01`, to };
}

function validDay(day: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) return false;
  const instant = new Date(`${day}T00:00:00Z`);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 10) === day
  );
}

// Find the first instant of a Cairo calendar day, including the seasonal
// offset change where a day can contain 23 or 25 hours.
function startOfCairoDay(day: string) {
  const center = new Date(`${day}T00:00:00Z`).getTime();
  let low = center - 18 * 3600000;
  let high = center + 18 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (cairoCalendarDay(new Date(mid)) >= day) high = mid;
    else low = mid;
  }
  return high;
}

export function dashboardInterval(days: DashboardDays) {
  if (!validDay(days.from) || !validDay(days.to) || days.from > days.to)
    return null;
  const distance = new Date(days.to).getTime() - new Date(days.from).getTime();
  if (distance >= 366 * DAY) return null;
  const nextDay = new Date(new Date(`${days.to}T00:00:00Z`).getTime() + DAY)
    .toISOString()
    .slice(0, 10);
  if (!validDay(nextDay)) return null;
  const from = startOfCairoDay(days.from);
  const to = startOfCairoDay(nextDay) - 1;
  if (to - from > 366 * DAY) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
