import { z } from 'zod';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const uzs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const phone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{9,15}$/, 'Invalid phone number'));
export const idParam = z.object({ id: z.uuid() });
export const optText = z.string().trim().max(2000).optional().nullable();
