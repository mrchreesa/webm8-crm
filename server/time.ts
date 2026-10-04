import { DateTime } from 'luxon';
export const nowISO = () => new Date().toISOString();
export function instant(value: string, allowFuture = false): string {
  if (!/T.*(Z|[+-]\d\d:?\d\d)$/.test(value))
    throw new Error('Use an ISO date and time with Z or an explicit UTC offset.');
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid || (!allowFuture && dt.toMillis() > Date.now() + 1000))
    throw new Error('Occurrence times must be valid and cannot be in the future.');
  return dt.toUTC().toISO({ suppressMilliseconds: false })!;
}
export function londonRange(from?: string, to?: string) {
  const parse = (s: string) => DateTime.fromFormat(s, 'yyyy-MM-dd', { zone: 'Europe/London' });
  if ((from && !parse(from).isValid) || (to && !parse(to).isValid) || (from && to && from > to))
    throw new Error('Choose a valid received date range.');
  return {
    from: from ? parse(from).startOf('day').toUTC().toISO()! : '0000',
    to: to ? parse(to).plus({ days: 1 }).startOf('day').toUTC().toISO()! : '9999',
  };
}
