import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RecentActivityItem } from '../models/activity.model';

@Injectable({ providedIn: 'root' })
export class ActivityService {
  private http = inject(HttpClient);

  getRecentActivity(): Observable<RecentActivityItem[]> {
    return this.http.get<RecentActivityItem[]>('/api/activity/recent');
  }
}
