/** Kommunikatsiya: Telegram bot status, linked parents, message log with retry (PRD §11). */
import { useState } from 'react';
import { post } from '../api';
import { Badge, Card, Empty, ErrorBox, errorText, fmtDateTime, Loading, PageHeader, useApi } from '../components/ui';
import { paginate, Pager, Summary, useDialogs, usePage } from '../components/kit';

interface Status {
  bot: { configured: boolean; username: string | null; lastPollAt: string | null; lastError: string | null };
  guardians: { linked: number; total: number };
  queue: Partial<Record<'queued' | 'sent' | 'failed' | 'skipped', number>>;
}

interface Row {
  id: string;
  template: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  guardianName: string | null;
}

const TEMPLATE_LABEL: Record<string, string> = {
  payment_received: 'To‘lov qabul qilindi',
  payment_due_soon: 'To‘lovga 3 kun qoldi',
  payment_overdue: 'To‘lov muddati o‘tdi',
  attendance_marked: 'Davomat',
  session_changed: 'Dars o‘zgardi',
  subscription_expiring: 'Abonement tugayapti',
};

const MSG_STATUS: Record<string, [string, 'neutral' | 'green' | 'red' | 'amber' | 'blue']> = {
  queued: ['Navbatda', 'blue'],
  sent: ['Yuborildi', 'green'],
  failed: ['Xato', 'red'],
  skipped: ['O‘tkazildi', 'neutral'],
};

export default function CommunicationPage() {
  const dialogs = useDialogs();
  const status = useApi<Status>('/notifications/status');
  const [filter, setFilter] = useState('');
  const log = useApi<Row[]>(`/notifications${filter ? `?status=${filter}` : ''}`);
  const s = status.data;
  const { page, setPage } = usePage();
  const pg = paginate(log.data ?? [], page);

  return (
    <>
      <PageHeader title="Kommunikatsiya" />
      <ErrorBox error={status.error} />
      {!s ? (
        <Loading />
      ) : (
        <Summary
          items={[
            { label: 'Telegram bot', value: s.bot.configured ? (s.bot.username ? `@${s.bot.username}` : 'ulanmoqda…') : 'sozlanmagan' },
            { label: 'Botga ulangan ota-onalar', value: `${s.guardians.linked}/${s.guardians.total}` },
            { label: 'Yuborilgan', value: s.queue.sent ?? 0 },
            { label: 'Navbatda', value: s.queue.queued ?? 0 },
            { label: 'Xatolar', value: s.queue.failed ?? 0, tone: s.queue.failed ? 'red' : undefined },
          ]}
        />
      )}
      {s && !s.bot.configured && (
        <div className="alert error" style={{ marginTop: 12 }}>
          Bot hali sozlanmagan: serverda <code>TELEGRAM_BOT_TOKEN</code> o‘rnatilishi kerak (@BotFather orqali olinadi). Shu paytgacha xabarlar navbatda
          saqlanadi va bot ulangach yuboriladi.
        </div>
      )}
      {s?.bot.username && (
        <Card title="Ota-onalarga yo‘riqnoma">
          <p>
            Telegramda <strong>@{s.bot.username}</strong> botini oching → <em>Start</em> → “📱 Telefon raqamni yuborish” tugmasini bosing. Raqam klubda
            ro‘yxatdan o‘tgan bo‘lishi kerak. Xabarlarni o‘chirish: botda “🔕 Xabarlarni o‘chirish”.
          </p>
          <p className="muted small">
            Havola: <code>https://t.me/{s.bot.username}</code>
          </p>
        </Card>
      )}

      <div className="tabs" role="tablist" style={{ marginTop: 16 }}>
        {[
          ['', 'Barchasi'],
          ['queued', 'Navbatda'],
          ['sent', 'Yuborilgan'],
          ['failed', 'Xatolar'],
          ['skipped', 'O‘tkazilgan'],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => (setFilter(k), setPage(1))}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={log.error} />
      {!log.data ? (
        <Loading />
      ) : !log.data.length ? (
        <Empty>Xabarlar yo‘q</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Turi</th>
                <th>Kimga</th>
                <th>Sportchi</th>
                <th>Holat</th>
                <th>Xato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pg.items.map((n) => {
                const [label, tone] = MSG_STATUS[n.status] ?? [n.status, 'neutral'];
                return (
                  <tr key={n.id}>
                    <td>{fmtDateTime(n.sentAt ?? n.createdAt)}</td>
                    <td>{TEMPLATE_LABEL[n.template] ?? n.template}</td>
                    <td>{n.guardianName ?? '—'}</td>
                    <td>{String(n.payload.athleteName ?? '—')}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge> {n.attempts > 1 && <span className="muted small">×{n.attempts}</span>}
                    </td>
                    <td className="muted small wrap">{n.lastError ?? ''}</td>
                    <td>
                      {(n.status === 'failed' || n.status === 'skipped') && (
                        <button
                          className="btn small ghost"
                          onClick={async () => {
                            try {
                              await post(`/notifications/${n.id}/retry`);
                              log.reload();
                              status.reload();
                            } catch (e) {
                              dialogs.toast(errorText(e), 'error');
                            }
                          }}
                        >
                          Qayta yuborish
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={pg.page} total={log.data.length} onPage={setPage} />
        </div>
      )}
    </>
  );
}

