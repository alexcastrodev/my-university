/** Mirrors the /api/admin responses (backend/src/admin, backend/src/ai). */

export const PERMISSIONS = [
  'admin.access',
  'users.view',
  'roles.manage',
  'ai_credits.grant',
  'ai_credits.reverse',
  'ai.use',
  'discussion.moderate',
  'ai_reports.review',
] as const;

export interface RoleView {
  id: number;
  name: string;
  system: boolean;
  permissions: string[];
  aiDailyCreditLimit: number;
  users: number;
}

export interface AdminUser {
  id: number;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
  createdAt: string;
  balance: number;
  roles: { id: number; name: string }[];
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

/** `kind` is the number the table stores: 1 admin grant, 2 purchase, 3 daily allowance, 4 reversal. */
export interface CreditGrant {
  id: string;
  kind: number;
  amount: number;
  reason: string;
  grantedByUserId: number | null;
  grantedByLogin: string | null;
  reversesGrantId: string | null;
  createdAt: string;
}

export interface UserCredits {
  balance: number;
  grants: CreditGrant[];
  usage: { day: string; questions: number; credits: number; costUsd: number }[];
}

export interface AuditEvent {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  actorUserId: number | null;
  actorLogin: string | null;
  targetUserId: number | null;
  targetLogin: string | null;
}

export interface PlatformBudget {
  day: { spentUsd: number; budgetUsd: number };
  month: { spentUsd: number; budgetUsd: number };
}

export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

export interface AdminReport {
  id: string;
  createdAt: string;
  status: ReportStatus;
  route: string[] | null;
  lang: string;
  postVersion: string | null;
  selection: string | null;
  question: string;
  answer: { blocks: { text: string }[] };
  model: string;
  promptVersion: number;
  note: string | null;
  reviewedAt: string | null;
}

/** What a failed admin call means for the screen. */
export type AdminErrorKind = 'forbidden' | 'conflict' | 'invalid' | 'failed';
