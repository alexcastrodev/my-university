import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AdminErrorKind,
  AdminReport,
  AdminUserPage,
  AuditEvent,
  CreditGrant,
  PlatformBudget,
  ReportStatus,
  RoleView,
  UserCredits,
} from './admin.model';

const API = '/api/admin';

export function adminErrorOf(error: unknown): AdminErrorKind {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 404 || status === 422) return 'invalid';
  return 'failed';
}

/** The calls of the admin screen. The server checks the permission of each one; the screen only hides what it cannot use. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);

  roles = () => firstValueFrom(this.http.get<RoleView[]>(`${API}/roles`));
  createRole = (name: string, permissions: string[], aiDailyCreditLimit: number) =>
    firstValueFrom(
      this.http.post<RoleView>(`${API}/roles`, { name, permissions, aiDailyCreditLimit }),
    );
  updateRole = (id: number, permissions: string[], aiDailyCreditLimit: number) =>
    firstValueFrom(
      this.http.put<RoleView>(`${API}/roles/${id}`, { permissions, aiDailyCreditLimit }),
    );
  deleteRole = (id: number) => firstValueFrom(this.http.delete<void>(`${API}/roles/${id}`));

  users = (q: string, page: number) =>
    firstValueFrom(this.http.get<AdminUserPage>(`${API}/users`, { params: { q, page } }));
  setUserRoles = (id: number, roleIds: number[]) =>
    firstValueFrom(this.http.put(`${API}/users/${id}/roles`, { roleIds }));

  credits = (userId: number) =>
    firstValueFrom(this.http.get<UserCredits>(`${API}/users/${userId}/credits`));
  grant = (userId: number, amount: number, reason: string) =>
    firstValueFrom(
      this.http.post<CreditGrant>(`${API}/users/${userId}/credits`, { amount, reason }),
    );
  reverse = (grantId: string, reason: string) =>
    firstValueFrom(this.http.post<CreditGrant>(`${API}/credits/${grantId}/reverse`, { reason }));

  audit = () => firstValueFrom(this.http.get<AuditEvent[]>(`${API}/audit`));
  budget = () => firstValueFrom(this.http.get<PlatformBudget>(`${API}/ai/budget`));
  reports = (status: ReportStatus | 'all', page: number) =>
    firstValueFrom(this.http.get<AdminReport[]>(`${API}/ai/reports`, { params: { status, page } }));
  reviewReport = (id: string, status: 'reviewed' | 'dismissed') =>
    firstValueFrom(this.http.put<void>(`${API}/ai/reports/${id}`, { status }));
}
