/**
 * Athlete documents card: 086 medical certificate (with expiry status), passport, birth certificate, other.
 * Files are opened through the API with the login token (never a public URL); photos are shrunk in the
 * browser before upload so phone pictures of a passport stay small.
 */
import { useRef, useState, type DragEvent } from 'react';
import { ApiError, del, getToken, post } from '../api';
import { Card, Empty, errorText, Field, fmtDate, Form, Loading, Modal, todayIso } from './ui';
import { Icon, useDialogs } from './kit';

export interface AthleteDocument {
  id: string;
  type: DocType;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  validUntil: string | null;
  createdAt: string;
  uploadedByName: string | null;
}
export type DocType = 'medical_086' | 'passport' | 'birth_certificate' | 'other';

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  medical_086: '086 tibbiy ma’lumotnoma',
  passport: 'Pasport',
  birth_certificate: 'Tug‘ilganlik guvohnomasi',
  other: 'Boshqa hujjat',
};

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';
const SOON_DAYS = 30;

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const daysUntil = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${todayIso()}T00:00:00`)) / 86_400_000);
const plusYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type MedicalState = { tone: 'green' | 'amber' | 'red' | 'neutral'; text: string; short: string };

/** Status of the newest 086 certificate: valid / ends soon / expired / missing. */
export function medicalState(docs: AthleteDocument[]): MedicalState {
  const med = docs.filter((d) => d.type === 'medical_086').sort((a, b) => (b.validUntil ?? '9999').localeCompare(a.validUntil ?? '9999'))[0];
  if (!med) return { tone: 'amber', text: '086 tibbiy ma’lumotnoma kiritilmagan', short: '086 yo‘q' };
  if (!med.validUntil) return { tone: 'neutral', text: '086 tibbiy ma’lumotnoma bor (muddati ko‘rsatilmagan)', short: '086 bor' };
  const left = daysUntil(med.validUntil);
  if (left < 0) return { tone: 'red', text: `086 muddati o‘tgan: ${fmtDate(med.validUntil)}`, short: '086 muddati o‘tgan' };
  if (left <= SOON_DAYS) return { tone: 'amber', text: `086 ${left} kunda tugaydi (${fmtDate(med.validUntil)})`, short: `086: ${left} kun qoldi` };
  return { tone: 'green', text: `086 amal qiladi: ${fmtDate(med.validUntil)} gacha`, short: '086 amal qiladi' };
}

/** Fetch the file with the token and show it in a new tab (PDF and images open inline). */
async function openDocument(athleteId: string, doc: AthleteDocument) {
  // Open the tab synchronously (popup blockers), then point it at the blob once loaded.
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`/api/athletes/${athleteId}/documents/${doc.id}/file`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
    if (!res.ok) throw new ApiError(res.status, 'error', res.status === 404 ? 'Hujjat topilmadi' : 'Faylni ochib bo‘lmadi');
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Downscale big photos (phone camera) to ≤ 2000 px JPEG; PDFs and small images are sent as they are. */
async function prepareFile(file: File): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith('image/') || (file.size < 1.5 * 1024 * 1024 && file.type !== 'image/heic')) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export function DocumentsCard({
  athleteId,
  docs,
  loading,
  canManage,
  reload,
}: {
  athleteId: string;
  docs: AthleteDocument[];
  loading: boolean;
  canManage: boolean;
  reload: () => void;
}) {
  const dialogs = useDialogs();
  const [adding, setAdding] = useState(false);
  const med = medicalState(docs);

  const open = async (d: AthleteDocument) => {
    try {
      await openDocument(athleteId, d);
    } catch (e) {
      dialogs.toast(errorText(e), 'error');
    }
  };
  const remove = async (d: AthleteDocument) => {
    const ok = await dialogs.confirm({
      title: 'Hujjatni o‘chirish',
      message: `“${d.title}” butunlay o‘chiriladi, faylni qayta tiklab bo‘lmaydi.`,
      confirmLabel: 'O‘chirish',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/athletes/${athleteId}/documents/${d.id}`);
      dialogs.toast('Hujjat o‘chirildi');
      reload();
    } catch (e) {
      dialogs.toast(errorText(e), 'error');
    }
  };

  return (
    <Card
      title="Hujjatlar"
      actions={
        canManage && (
          <button className="btn small" onClick={() => setAdding(true)}>
            + Hujjat
          </button>
        )
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className={`doc-status ${med.tone}`}>
            <Icon name={med.tone === 'green' ? 'check' : 'alert'} size={16} />
            <span>{med.text}</span>
          </div>
          {!docs.length ? (
            <Empty>{canManage ? 'Pasport, tug‘ilganlik guvohnomasi yoki 086 ma’lumotnomani yuklang' : 'Hujjat yo‘q'}</Empty>
          ) : (
            <ul className="rows doc-list">
              {docs.map((d) => {
                const expired = d.validUntil != null && daysUntil(d.validUntil) < 0;
                return (
                  <li key={d.id}>
                    <span className="doc-icon" aria-hidden="true">
                      {d.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}
                    </span>
                    <button type="button" className="doc-main" onClick={() => open(d)} title="Ochish">
                      <span className="row-main">{d.title}</span>
                      <span className="row-sub">
                        {DOC_TYPE_LABEL[d.type]} · {fmtSize(d.sizeBytes)}
                        {d.validUntil && (
                          <>
                            {' · '}
                            <span className={expired ? 'debt' : ''}>
                              {expired ? 'muddati o‘tgan' : 'amal qiladi'} {fmtDate(d.validUntil)}
                              {expired ? '' : ' gacha'}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                    {canManage && (
                      <button className="btn small ghost danger" onClick={() => remove(d)} aria-label={`${d.title} — o‘chirish`}>
                        O‘chirish
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {adding && (
        <UploadModal
          athleteId={athleteId}
          hasMedical={docs.some((d) => d.type === 'medical_086')}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            dialogs.toast('Hujjat yuklandi');
            reload();
          }}
        />
      )}
    </Card>
  );
}

function UploadModal({ athleteId, hasMedical, onClose, onDone }: { athleteId: string; hasMedical: boolean; onClose: () => void; onDone: () => void }) {
  const initial: DocType = hasMedical ? 'passport' : 'medical_086';
  const [type, setType] = useState<DocType>(initial);
  const [title, setTitle] = useState(DOC_TYPE_LABEL[initial]);
  const [titleTouched, setTitleTouched] = useState(false);
  const [validUntil, setValidUntil] = useState(initial === 'medical_086' ? plusYear(todayIso()) : '');
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pickType = (t: DocType) => {
    setType(t);
    if (!titleTouched) setTitle(DOC_TYPE_LABEL[t]);
    if (t === 'medical_086' && !validUntil) setValidUntil(plusYear(todayIso()));
    if (t !== 'medical_086' && validUntil === plusYear(todayIso())) setValidUntil('');
  };
  const choose = (f: File | undefined | null) => {
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) {
      setFileErr('Faqat PDF, JPG, PNG yoki WEBP fayl');
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES * 3) {
      setFileErr('Fayl juda katta (10 MB gacha)');
      setFile(null);
      return;
    }
    setFileErr(null);
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files?.[0]);
  };

  return (
    <Modal title="Hujjat qo‘shish" onClose={onClose}>
      <Form
        submitLabel="Yuklash"
        onSubmit={async () => {
          if (!file) throw new Error('Faylni tanlang');
          const { blob, name } = await prepareFile(file);
          if (blob.size > MAX_BYTES) throw new Error('Fayl 10 MB dan katta. Kichikroq skan yoki rasm tanlang.');
          await post(`/athletes/${athleteId}/documents`, {
            type,
            title: title.trim() || DOC_TYPE_LABEL[type],
            fileName: name,
            validUntil: validUntil || null,
            content: await toBase64(blob),
          });
          onDone();
        }}
      >
        <Field label="Hujjat turi">
          <select value={type} onChange={(e) => pickType(e.target.value as DocType)}>
            {(Object.keys(DOC_TYPE_LABEL) as DocType[]).map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid2">
          <Field label="Hujjat nomi">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              maxLength={200}
              required
            />
          </Field>
          <Field label={type === 'medical_086' ? 'Amal qiladi (gacha) *' : 'Amal qiladi (gacha)'} hint={type === 'medical_086' ? 'Odatda 1 yil' : 'Ixtiyoriy'}>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} required={type === 'medical_086'} />
          </Field>
        </div>
        <div className="field">
          <span>Fayl *</span>
          <div
            className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
          >
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => choose(e.target.files?.[0])} />
            <button type="button" className="btn small" onClick={() => input.current?.click()}>
              <Icon name="upload" size={15} /> {file ? 'Boshqa fayl' : 'Fayl tanlash'}
            </button>
            <span className="dropzone-text">
              {file ? (
                <>
                  <strong>{file.name}</strong> <span className="muted">· {fmtSize(file.size)}</span>
                </>
              ) : (
                <span className="muted">yoki shu yerga tashlang · PDF, JPG, PNG · 10 MB gacha</span>
              )}
            </span>
          </div>
          {fileErr && <small className="debt">{fileErr}</small>}
        </div>
        <p className="muted small">Telefon rasmlari avtomatik kichraytiriladi. Pasport va guvohnomani faqat klub egasi va filial administratori ko‘radi.</p>
      </Form>
    </Modal>
  );
}

