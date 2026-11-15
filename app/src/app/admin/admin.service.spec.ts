import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService, adminErrorOf } from './admin.service';

describe('adminErrorOf', () => {
  const failed = (status: number) => new HttpErrorResponse({ status });

  it('tells a missing permission, a clash and a rejected value apart from a failure', () => {
    expect(adminErrorOf(failed(403))).toBe('forbidden');
    expect(adminErrorOf(failed(409))).toBe('conflict');
    for (const status of [400, 404, 422]) expect(adminErrorOf(failed(status))).toBe('invalid');
    expect(adminErrorOf(failed(500))).toBe('failed');
    expect(adminErrorOf(new Error('offline'))).toBe('failed');
  });
});

describe('AdminService', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    return { admin: TestBed.inject(AdminService), http: TestBed.inject(HttpTestingController) };
  }

  it('searches users by text and page', () => {
    const { admin, http } = setup();
    void admin.users('ana', 2);
    const req = http.expectOne((r) => r.url === '/api/admin/users');
    expect(req.request.params.get('q')).toBe('ana');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, pageSize: 25 });
  });

  it('grants and reverses credits with the reason the audit trail keeps', () => {
    const { admin, http } = setup();
    void admin.grant(7, 25, 'workshop');
    const grant = http.expectOne('/api/admin/users/7/credits');
    expect(grant.request.method).toBe('POST');
    expect(grant.request.body).toEqual({ amount: 25, reason: 'workshop' });
    grant.flush({});
    void admin.reverse('g1', 'typo');
    const reverse = http.expectOne('/api/admin/credits/g1/reverse');
    expect(reverse.request.body).toEqual({ reason: 'typo' });
    reverse.flush({});
  });

  it("sends the permissions and the limit of a role, and the ids of a person's roles", () => {
    const { admin, http } = setup();
    void admin.createRole('tutor', ['ai.use'], 50);
    expect(http.expectOne('/api/admin/roles').request.body).toEqual({
      name: 'tutor',
      permissions: ['ai.use'],
      aiDailyCreditLimit: 50,
    });
    void admin.updateRole(3, ['ai.use', 'users.view'], 0);
    const update = http.expectOne('/api/admin/roles/3');
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({
      permissions: ['ai.use', 'users.view'],
      aiDailyCreditLimit: 0,
    });
    void admin.setUserRoles(9, [1, 3]);
    expect(http.expectOne('/api/admin/users/9/roles').request.body).toEqual({ roleIds: [1, 3] });
  });

  it('asks for the reports of one status', () => {
    const { admin, http } = setup();
    void admin.reports('open', 1);
    const req = http.expectOne((r) => r.url === '/api/admin/ai/reports');
    expect(req.request.params.get('status')).toBe('open');
    req.flush([]);
    void admin.reviewReport('r1', 'dismissed');
    expect(http.expectOne('/api/admin/ai/reports/r1').request.body).toEqual({
      status: 'dismissed',
    });
  });
});
