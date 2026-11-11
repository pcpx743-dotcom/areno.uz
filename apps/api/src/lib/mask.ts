/** Mask phone numbers for logs: +998901234567 → +99890*****67 (PRD §12). */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\s+/g, '');
  if (digits.length <= 6) return '***';
  return digits.slice(0, 6) + '*'.repeat(digits.length - 8) + digits.slice(-2);
}
