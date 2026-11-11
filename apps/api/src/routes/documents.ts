/**
 * Athlete documents: 086 medical certificate, passport, birth certificate, other scans.
 *
 * Access: owner and branch admin (own branches) see and manage all documents. A coach of the athlete
 * may see and open only the 086 medical certificate (to know the athlete is cleared to train) —
 * identity documents are never shown to coaches. Every upload, download and delete is audited.
 * Files are PDF / JPEG / PNG / WEBP up to 10 MB; the type is checked from the file bytes, not the name.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { athleteDocuments, documentFiles, users } from '../db/schema.js';
import { requireClub, type ClubCtx } from '../auth/context.js';
import { loadAthlete } from '../lib/loaders.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isoDate } from '../lib/validation.js';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOC_TYPES = ['medical_086', 'passport', 'birth_certificate', 'other'] as const;

/** Identify the file from its first bytes; anything else is rejected. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const params = z.object({ id: z.uuid() });
const docParams = z.object({ id: z.uuid(), docId: z.uuid() });
const uploadBody = z.object({
  type: z.enum(DOC_TYPES),
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  validUntil: isoDate.nullable().optional(),
  /** File content, base64 (no data: prefix). */
  content: z.string().min(1).max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8),
});

const isCoach = (ctx: ClubCtx) => ctx.role === 'coach';
/** Coaches only ever see the medical certificate. */
const visibleTo = (ctx: ClubCtx, type: string) => !isCoach(ctx) || type === 'medical_086';
/** Header-safe filename: ASCII fallback + RFC 5987 UTF-8 form. */
const disposition = (name: string) =>
  `inline; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export default async function documentRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/:id/documents', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id } = params.parse(req.params);
    await loadAthlete(db, ctx, id);
    const rows = await db
      .select({
        id: athleteDocuments.id,
        type: athleteDocuments.type,
        title: athleteDocuments.title,
        fileName: athleteDocuments.fileName,
        mimeType: athleteDocuments.mimeType,
        sizeBytes: athleteDocuments.sizeBytes,
        validUntil: athleteDocuments.validUntil,
        createdAt: athleteDocuments.createdAt,
        uploadedByName: users.fullName,
      })
      .from(athleteDocuments)
      .leftJoin(users, eq(users.id, athleteDocuments.uploadedBy))
      .where(and(eq(athleteDocuments.clubId, ctx.clubId), eq(athleteDocuments.athleteId, id)))
      .orderBy(desc(athleteDocuments.createdAt));
    return rows.filter((r) => visibleTo(ctx, r.type));
  });

  app.post('/:id/documents', { bodyLimit: Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 64 * 1024 }, async (req, reply) => {
    const ctx = requireClub(req, 'owner', 'branch_admin');
    const { id } = params.parse(req.params);
    const body = uploadBody.parse(req.body);
    const athlete = await loadAthlete(db, ctx, id);
    const buf = Buffer.from(body.content, 'base64');
    if (!buf.length) throw badRequest('empty_file', 'Fayl bo‘sh');
    if (buf.length > MAX_DOCUMENT_BYTES) throw badRequest('file_too_large', 'Fayl 10 MB dan katta');
    const mimeType = sniffMime(buf);
    if (!mimeType) throw badRequest('unsupported_file', 'Faqat PDF, JPG, PNG yoki WEBP fayl yuklash mumkin');

    const doc = await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(athleteDocuments)
        .values({
          clubId: ctx.clubId,
          athleteId: athlete.id,
          type: body.type,
          title: body.title,
          fileName: body.fileName,
          mimeType,
          sizeBytes: buf.length,
          validUntil: body.validUntil ?? null,
          uploadedBy: ctx.userId,
        })
        .returning();
      await tx.insert(documentFiles).values({ documentId: d.id, content: buf });
      await audit(tx, ctx, { action: 'create', entity: 'athlete_documents', entityId: d.id, after: d });
      return d;
    });
    return reply.status(201).send(doc);
  });

  app.patch('/:id/documents/:docId', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin');
    const { id, docId } = docParams.parse(req.params);
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), validUntil: isoDate.nullable().optional() }).parse(req.body);
    await loadAthlete(db, ctx, id);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(athleteDocuments)
        .where(and(eq(athleteDocuments.id, docId), eq(athleteDocuments.athleteId, id), eq(athleteDocuments.clubId, ctx.clubId)));
      if (!before) throw notFound('Document');
      const [after] = await tx.update(athleteDocuments).set(body).where(eq(athleteDocuments.id, docId)).returning();
      await audit(tx, ctx, { action: 'update', entity: 'athlete_documents', entityId: docId, before, after });
      return after;
    });
  });

  app.get('/:id/documents/:docId/file', async (req, reply) => {
    const ctx = requireClub(req, 'owner', 'branch_admin', 'coach');
    const { id, docId } = docParams.parse(req.params);
    await loadAthlete(db, ctx, id);
    const [row] = await db
      .select({ doc: athleteDocuments, content: documentFiles.content })
      .from(athleteDocuments)
      .innerJoin(documentFiles, eq(documentFiles.documentId, athleteDocuments.id))
      .where(and(eq(athleteDocuments.id, docId), eq(athleteDocuments.athleteId, id), eq(athleteDocuments.clubId, ctx.clubId)));
    if (!row || !visibleTo(ctx, row.doc.type)) throw notFound('Document');
    await audit(db, ctx, { action: 'download', entity: 'athlete_documents', entityId: docId });
    return reply
      .header('Content-Type', row.doc.mimeType)
      .header('Content-Length', String(row.content.length))
      .header('Content-Disposition', disposition(row.doc.fileName))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .send(row.content);
  });

  app.delete('/:id/documents/:docId', async (req) => {
    const ctx = requireClub(req, 'owner', 'branch_admin');
    const { id, docId } = docParams.parse(req.params);
    await loadAthlete(db, ctx, id);
    return db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(athleteDocuments)
        .where(and(eq(athleteDocuments.id, docId), eq(athleteDocuments.athleteId, id), eq(athleteDocuments.clubId, ctx.clubId)));
      if (!before) throw notFound('Document');
      // The row and its file are removed for real: identity documents should not linger after deletion.
      await tx.delete(athleteDocuments).where(eq(athleteDocuments.id, docId));
      await audit(tx, ctx, { action: 'delete', entity: 'athlete_documents', entityId: docId, before });
      return { ok: true };
    });
  });
}
