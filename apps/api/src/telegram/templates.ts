/** Uzbek message texts for queued notifications (PRD §10). HTML parse mode. */

export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const som = (n: unknown) => `${new Intl.NumberFormat('ru-RU').format(Number(n) || 0).replace(/ /g, ' ')} so‘m`;

export const dmy = (d: unknown) => {
  const s = String(d ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};

const hm = (t: unknown) => String(t ?? '').slice(0, 5);

const ATT: Record<string, string> = { present: 'keldi ✅', absent: 'kelmadi ❌', excused: 'sababli kelmadi 🟡' };

export function renderNotification(template: string, p: Record<string, unknown>, clubName: string): string {
  const head = `<b>${esc(clubName)}</b>\n`;
  const name = `<b>${esc(p.athleteName)}</b>`;
  switch (template) {
    case 'payment_received': {
      const tail =
        Number(p.debt) > 0 ? `Qolgan qarz: <b>${som(p.debt)}</b>` : Number(p.advance) > 0 ? `Avans: <b>${som(p.advance)}</b>` : 'Qarz yo‘q.';
      return `${head}✅ To‘lov qabul qilindi\n${name}: <b>${som(p.amount)}</b> (${dmy(p.paidAt)})\nKvitansiya: ${esc(p.receiptNo)}\n${tail}`;
    }
    case 'payment_due_soon':
      return `${head}⏰ Eslatma: ${name} uchun <b>${som(p.outstanding)}</b> to‘lov muddati — <b>${dmy(p.dueDate)}</b>.\n${esc(p.description)}`;
    case 'payment_overdue':
      return `${head}❗ ${name}: <b>${som(p.outstanding)}</b> to‘lov muddati (${dmy(p.dueDate)}) o‘tib ketdi. Iltimos, klubga to‘lovni amalga oshiring.`;
    case 'attendance_marked':
      return `${head}${name} ${dmy(p.sessionDate)} kuni “${esc(p.groupName)}” mashg‘ulotiga ${ATT[String(p.status)] ?? esc(p.status)}`;
    case 'session_changed': {
      const what =
        p.status === 'cancelled'
          ? `${dmy(p.sessionDate)} ${hm(p.startTime)} dagi mashg‘ulot <b>bekor qilindi</b>`
          : `mashg‘ulot <b>${dmy(p.sessionDate)} ${hm(p.startTime)}</b> ga ko‘chirildi`;
      return `${head}📅 “${esc(p.groupName ?? '')}”: ${what}.${p.note ? `\nIzoh: ${esc(p.note)}` : ''}`;
    }
    case 'subscription_expiring':
      return `${head}🔔 ${name} abonementi <b>${dmy(p.endDate)}</b> da tugaydi.`;
    default:
      return `${head}${esc(template)}`;
  }
}
