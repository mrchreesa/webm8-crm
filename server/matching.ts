import { createHash } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export function metaId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{4,39}$/.test(value))
    throw new Error(
      'Meta IDs must be exact digit strings. Scientific notation and numeric JSON values are not accepted.',
    );
  return value;
}
export function normalizeEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
export function normalizePhone(phone: string): string | null {
  let value = phone.trim();
  if (value.startsWith('00')) value = '+' + value.slice(2);
  if (/^44\d{9,10}$/.test(value)) value = '+' + value;
  const parsed = parsePhoneNumberFromString(value, 'GB');
  if (parsed?.isValid()) return parsed.number.replace(/\D/g, '');
  // Accept an already international digits-only value if GB parsing did not validate it.
  if (/^[1-9][\d ().-]{6,25}$/.test(value)) {
    const digits = value.replace(/\D/g, ''),
      international = parsePhoneNumberFromString('+' + digits);
    if (international?.isValid()) return international.number.replace(/\D/g, '');
  }
  return null;
}
export function matchingIdentifiers(
  leadId: string,
  email: string,
  phone: string,
  includeContact = true,
) {
  const data: { lead_id: string; em?: string[]; ph?: string[] } = { lead_id: metaId(leadId) };
  const em = normalizeEmail(email),
    ph = normalizePhone(phone);
  if (includeContact && em) data.em = [sha256(em)];
  if (includeContact && ph) data.ph = [sha256(ph)];
  return data;
}
