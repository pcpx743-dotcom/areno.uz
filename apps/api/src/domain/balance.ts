/**
 * Balance (PRD §6):
 *   balance = Σ charges − Σ confirmed payments (net of reversals) − Σ approved adjustments
 * Positive = debt, negative = advance (overpayment).
 */
export interface BalanceInputs {
  charges: { amount: number; status?: string }[];
  payments: { amount: number }[]; // reversals are negative rows
  adjustments: { amount: number }[];
}

export interface Balance {
  charged: number;
  paid: number;
  adjusted: number;
  balance: number;
  debt: number;
  advance: number;
}

export function computeBalance({ charges, payments, adjustments }: BalanceInputs): Balance {
  const charged = sum(charges.filter((c) => c.status !== 'void').map((c) => c.amount));
  const paid = sum(payments.map((p) => p.amount));
  const adjusted = sum(adjustments.map((a) => a.amount));
  const balance = charged - paid - adjusted;
  return { charged, paid, adjusted, balance, debt: Math.max(0, balance), advance: Math.max(0, -balance) };
}

/**
 * Allocate a payment across open charges, oldest due date first.
 * Returns allocations and the unallocated remainder (kept as advance).
 */
export function allocatePayment(
  amount: number,
  openCharges: { id: string; dueDate: string; amount: number; paidAmount: number }[],
): { allocations: { chargeId: string; amount: number }[]; remainder: number } {
  let left = amount;
  const allocations: { chargeId: string; amount: number }[] = [];
  const sorted = [...openCharges].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  for (const c of sorted) {
    if (left <= 0) break;
    const due = c.amount - c.paidAmount;
    if (due <= 0) continue;
    const take = Math.min(due, left);
    allocations.push({ chargeId: c.id, amount: take });
    left -= take;
  }
  return { allocations, remainder: left };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
