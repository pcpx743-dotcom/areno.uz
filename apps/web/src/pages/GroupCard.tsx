import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, post } from '../api';
import { useRole } from '../auth';
import { ageFrom, Card, Empty, ErrorBox, Field, fmtDate, Form, Loading, Modal, PageHeader, StatusBadge, useApi, WEEKDAYS } from '../components/ui';
import type { Group } from '../types';
import { GroupFormModal } from './Groups';

interface GroupDetail extends Group {
  athletes: { enrollmentId: string; athleteId: string; fullName: string; birthDate: string | null; status: string; startedAt: string }[];
  schedules: { id: string; weekday: number; startTime: string; endTime: string; room: string | null }[];
}

export default function GroupCardPage() {
  const { id } = useParams();
  const role = useRole();
  const isStaff = role === 'owner' || role === 'branch_admin';
  const { data: g, error, reload } = useApi<GroupDetail>(`/groups/${id}`);
  const [modal, setModal] = useState<null | 'edit' | 'schedule'>(null);
  if (error) return <ErrorBox error={error} />;
  if (!g) return <Loading />;
  const active = g.athletes.filter((a) => a.status === 'active').length;

  return (
    <>
      <PageHeader
        title={g.name}
        subtitle={`${g.sportName} · ${g.branchName} · Murabbiy: ${g.coachName ?? '—'}`}
        actions={
          isStaff && (
            <button className="btn" onClick={() => setModal('edit')}>
              Tahrirlash
            </button>
          )
        }
      />
      <div className="cols">
        <div className="col">
          <Card title={`Sportchilar (${active}/${g.capacity ?? '∞'})`}>
            {g.athletes.length === 0 ? (
              <Empty>Guruhda sportchi yo‘q</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>F.I.Sh.</th>
                      <th>Yosh</th>
                      <th>Qo‘shilgan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.athletes.map((a) => (
                      <tr key={a.enrollmentId}>
                        <td>
                          <Link to={`/athletes/${a.athleteId}`}>{a.fullName}</Link>
                        </td>
                        <td>{ageFrom(a.birthDate) ?? '—'}</td>
                        <td>{fmtDate(a.startedAt)}</td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="col">
          <Card
            title="Haftalik jadval"
            actions={
              isStaff && (
                <button className="btn small" onClick={() => setModal('schedule')}>
                  + Qo‘shish
                </button>
              )
            }
          >
            {g.schedules.length === 0 ? (
              <Empty>Jadval kiritilmagan</Empty>
            ) : (
              <ul className="list">
                {g.schedules.map((s) => (
                  <li key={s.id} className="row-between">
                    <span>
                      <strong>{WEEKDAYS[s.weekday]}</strong> {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
                      {s.room && <span className="muted"> · {s.room}</span>}
                    </span>
                    {isStaff && (
                      <button
                        className="btn small ghost danger"
                        aria-label="O‘chirish"
                        onClick={async () => {
                          await del(`/groups/${g.id}/schedules/${s.id}`);
                          reload();
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Ma’lumot">
            <dl className="dl">
              <dt>Yosh oralig‘i</dt>
              <dd>{g.ageMin != null || g.ageMax != null ? `${g.ageMin ?? ''}–${g.ageMax ?? ''}` : '—'}</dd>
              <dt>Sig‘im</dt>
              <dd>{g.capacity ?? 'cheklanmagan'}</dd>
            </dl>
          </Card>
        </div>
      </div>
      {modal === 'edit' && (
        <GroupFormModal
          group={g}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reload();
          }}
        />
      )}
      {modal === 'schedule' && (
        <ScheduleModal
          groupId={g.id}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function ScheduleModal({ groupId, onClose, onDone }: { groupId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ weekday: '1', startTime: '18:00', endTime: '19:30', room: '' });
  return (
    <Modal title="Jadvalga qo‘shish" onClose={onClose}>
      <Form
        onSubmit={async () => {
          await post(`/groups/${groupId}/schedules`, { ...f, weekday: Number(f.weekday), room: f.room || null });
          onDone();
        }}
      >
        <Field label="Hafta kuni">
          <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
            {WEEKDAYS.slice(1).map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid2">
          <Field label="Boshlanish">
            <input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
          </Field>
          <Field label="Tugash">
            <input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
          </Field>
        </div>
        <Field label="Zal">
          <input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
        </Field>
      </Form>
    </Modal>
  );
}
