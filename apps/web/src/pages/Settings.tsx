import { useEffect, useState } from 'react';
import { patch } from '../api';
import { Badge, Card, Field, Form, Loading, PageHeader, useApi } from '../components/ui';

interface Settings {
  capacityPolicy: 'warn' | 'block';
  calendarProration: 'full' | 'daily';
  sessionPackCountsAbsent: boolean;
  sessionPackCountsExcused: boolean;
  maxFreezeDays: number;
  maxFreezesPerSubscription: number;
  autoRenew: boolean;
  debtorPolicy: 'warn' | 'block';
  attendanceNotify: 'all' | 'absent_only' | 'off';
}


export default function SettingsPage() {
  const { data } = useApi<{ name: string; timezone: string; settings: Settings }>('/club');
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (!s || !data) return <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setS({ ...s, [k]: v });
  };

  return (
    <>
      <PageHeader title="Klub sozlamalari" subtitle={`${data.name} · ${data.timezone}`} />
      <Card>
        <Form
          onSubmit={async () => {
            await patch('/club/settings', s);
            setSaved(true);
          }}
        >
          <h3>Abonement qoidalari</h3>
          <Field label="Kalendar oy: oy o‘rtasida qo‘shilganda">
            <select value={s.calendarProration} onChange={(e) => set('calendarProration', e.target.value as Settings['calendarProration'])}>
              <option value="full">To‘liq narx</option>
              <option value="daily">Kunlar bo‘yicha (proratsiya)</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={s.sessionPackCountsAbsent} onChange={(e) => set('sessionPackCountsAbsent', e.target.checked)} /> Darslar
            soni modelida “kelmadi” darsni sarflaydi
          </label>
          <label className="check">
            <input type="checkbox" checked={s.sessionPackCountsExcused} onChange={(e) => set('sessionPackCountsExcused', e.target.checked)} />{' '}
            “Sababli” ham darsni sarflaydi
          </label>
          <div className="grid2">
            <Field label="Muzlatish: maksimal kunlar">
              <input type="number" min={0} value={s.maxFreezeDays} onChange={(e) => set('maxFreezeDays', Number(e.target.value))} />
            </Field>
            <Field label="Muzlatish: maksimal marta">
              <input type="number" min={0} value={s.maxFreezesPerSubscription} onChange={(e) => set('maxFreezesPerSubscription', Number(e.target.value))} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.autoRenew} onChange={(e) => set('autoRenew', e.target.checked)} /> Muddat tugaganda keyingi davr
            uchun avtomatik hisob yaratish
          </label>

          <h3>Guruh va qarzdorlik</h3>
          <Field label="Guruh sig‘imi to‘lganda">
            <select value={s.capacityPolicy} onChange={(e) => set('capacityPolicy', e.target.value as Settings['capacityPolicy'])}>
              <option value="warn">Ogohlantirish (tasdiqlab qo‘shish mumkin)</option>
              <option value="block">Bloklash</option>
            </select>
          </Field>
          <Field label="Qarzdor sportchi darsga">
            <select value={s.debtorPolicy} onChange={(e) => set('debtorPolicy', e.target.value as Settings['debtorPolicy'])}>
              <option value="warn">Kiritiladi, ogohlantirish</option>
              <option value="block">Bloklanadi</option>
            </select>
          </Field>

          <h3>Telegram xabarlari</h3>
          <Field label="Davomat haqida ota-onaga xabar">
            <select value={s.attendanceNotify} onChange={(e) => set('attendanceNotify', e.target.value as Settings['attendanceNotify'])}>
              <option value="absent_only">Faqat kelmaganda</option>
              <option value="all">Har darsda</option>
              <option value="off">Yuborilmasin</option>
            </select>
          </Field>
          {saved && <div className="alert ok">Saqlandi</div>}
        </Form>
      </Card>
    </>
  );
}
