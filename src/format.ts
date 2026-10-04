import { DateTime } from 'luxon';
export const money = (minor: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);
export function date(value: string | null | undefined, withTime = true) {
  return value
    ? DateTime.fromISO(value)
        .setZone('Europe/London')
        .toFormat(withTime ? 'd MMM yyyy, HH:mm' : 'd MMM yyyy')
    : '—';
}
export const localInput = (value?: string | null) =>
  DateTime.fromISO(value || new Date().toISOString())
    .setZone('Europe/London')
    .toFormat("yyyy-MM-dd'T'HH:mm");
export function toUTC(value: string): string | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: 'Europe/London' });
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value)
    throw new Error(
      'Choose a valid London date and time. This time may fall in a daylight-saving gap.',
    );
  return dt.toUTC().toISO()!;
}
export const today = () => DateTime.now().setZone('Europe/London').toISODate()!;
export function toMinor(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter a GBP value with up to two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const STATUS_LABELS: Record<string, string> = {
  accepted: 'Accepted by Meta',
  pending: 'Pending',
  processing: 'Sending',
  failed: 'Failed',
  expired: 'Expired',
  suppressed: 'Not sent',
  demo: 'Demo · not sent',
  ineligible: 'CRM only',
};
