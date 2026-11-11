/** CSV import of athletes + parents: preview first, then all-or-nothing import. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken, post } from '../api';
import { Badge, Card, ErrorBox, errorText, PageHeader } from '../components/ui';

interface Result {
  dryRun: boolean;
  imported: number;
  summary: { total: number; valid: number; errors: number; duplicates: number; toImport: number };
  rows: { line: number; fullName: string; errors: string[]; warnings: string[] }[];
}

export default function ImportPage() {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await post<Result>('/import/athletes', { csv, dryRun }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    const res = await fetch('/api/import/athletes/template', { headers: { authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sportchilar-shablon.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const shown = result?.rows.filter((r) => r.errors.length || r.warnings.length) ?? [];

  return (
    <>
      <PageHeader
        title="Sportchilarni import qilish"
        actions={
          <button className="btn" onClick={downloadTemplate}>
            Shablonni yuklab olish
          </button>
        }
      />
      <Card>
        <div className="form">
          <label className="field">
            <span>CSV fayl</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setCsv(await f.text());
                setResult(null);
              }}
            />
          </label>
          <label className="field">
            <span>yoki matnni joylashtiring</span>
            <textarea
              rows={6}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setResult(null);
              }}
              placeholder="full_name;birth_date;branch;group;guardian_name;guardian_phone;guardian_relation"
              spellCheck={false}
              className="mono"
            />
          </label>
          <p className="muted small">
            Ustunlar: <strong>full_name</strong>*, <strong>branch</strong>* (filial nomi), birth_date (15.03.2015), phone, group (guruh nomi), joined_at,
            guardian_name, guardian_phone, guardian_relation (ona / ota / vasiy), note. O‘zbekcha sarlavhalar ham qabul qilinadi (F.I.Sh., Filial, Guruh,
            Ota-ona, Ota-ona telefon…). Bir xil telefonli ota-ona bitta yozuv bo‘lib, barcha farzandlariga bog‘lanadi.
          </p>
          <ErrorBox error={err} />
          <div className="form-actions">
            <button className="btn" disabled={!csv || busy} onClick={() => run(true)}>
              {busy ? '…' : 'Tekshirish'}
            </button>
            <button className="btn primary" disabled={!result || result.summary.errors > 0 || result.summary.toImport === 0 || !result.dryRun || busy} onClick={() => run(false)}>
              Import qilish{result?.dryRun && result.summary.toImport ? ` (${result.summary.toImport})` : ''}
            </button>
          </div>
        </div>
      </Card>

      {result && (
        <Card title={result.dryRun ? `Tekshiruv natijasi${fileName ? ` — ${fileName}` : ''}` : 'Import yakunlandi'}>
          <p>
            Jami: <strong>{result.summary.total}</strong> · to‘g‘ri: <strong>{result.summary.valid}</strong> ·{' '}
            {result.summary.errors > 0 ? <Badge tone="red">{result.summary.errors} xato</Badge> : <Badge tone="green">xato yo‘q</Badge>} ·
            takror: {result.summary.duplicates} · {result.dryRun ? `import qilinadi: ${result.summary.toImport}` : <strong className="ok">import qilindi: {result.imported}</strong>}
          </p>
          {!result.dryRun && (
            <p>
              <Link to="/athletes">Sportchilar ro‘yxatiga o‘tish →</Link>
            </p>
          )}
          {shown.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">Qator</th>
                    <th>F.I.Sh.</th>
                    <th>Muammo</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td>{r.fullName || '—'}</td>
                      <td className="wrap">
                        {r.errors.map((e) => (
                          <div key={e} className="debt">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w) => (
                          <div key={w} className="muted">
                            {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
