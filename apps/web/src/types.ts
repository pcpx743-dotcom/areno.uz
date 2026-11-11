export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
}
export interface Sport {
  id: string;
  name: string;
  active: boolean;
}
export interface Coach {
  id: string;
  fullName: string;
  phone: string | null;
  employment: string | null;
  active: boolean;
  userId: string | null;
  groupCount: number;
}
export interface Group {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  sportId: string;
  sportName: string;
  coachId: string | null;
  coachName: string | null;
  coachPhone?: string | null;
  capacity: number | null;
  ageMin: number | null;
  ageMax: number | null;
  active: boolean;
  athleteCount: number;
}
export interface Plan {
  id: string;
  name: string;
  sportId: string | null;
  kind: 'group' | 'single' | 'individual';
  billingType: 'calendar_month' | 'fixed_days' | 'session_pack';
  price: number;
  durationDays: number | null;
  sessionLimit: number | null;
  maxValidityDays: number | null;
  branchIds: string[];
  active: boolean;
}
export interface AthleteListItem {
  id: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  branchId: string;
  status: string;
  joinedAt: string;
  groupNames: string[];
  subscription: { planName: string; status: string; startDate: string; endDate: string | null } | null;
  lastSeen: string | null;
  balance?: number;
}
export interface Subscription {
  id: string;
  planName: string;
  billingType: string;
  startDate: string;
  endDate: string | null;
  price?: number;
  discount?: number;
  sessionLimit: number | null;
  usedSessions: number;
  remainingSessions: number | null;
  status: string;
}
export interface AthleteProfile {
  id: string;
  fullName: string;
  birthDate: string | null;
  phone: string | null;
  branchId: string;
  status: string;
  joinedAt: string;
  note: string | null;
  guardians: {
    id: string;
    fullName: string;
    phone: string | null;
    relation: string;
    isPrimary: boolean;
    telegramLinked: boolean;
    telegramConsentAt: string | null;
  }[];
  enrollments: {
    id: string;
    groupId: string;
    groupName: string;
    sportName: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    reason: string | null;
  }[];
  subscriptions: Subscription[];
  charges?: { id: string; description: string; dueDate: string; amount: number; paidAmount: number; status: string }[];
  payments?: { id: string; amount: number; paidAt: string; receiptNo: string | null; note: string | null; reversalOfId: string | null }[];
  balance?: { charged: number; paid: number; adjusted: number; balance: number; debt: number; advance: number };
}
