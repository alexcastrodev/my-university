import { ChangeDetectionStrategy, Component, inject, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { AuthService } from './services/auth.service';
import { XpService } from './services/xp.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Header, RouterOutlet],
  template: `
    <app-header></app-header>
    <router-outlet></router-outlet>
  `,
  styles: ``,
})
export class App {
  private auth = inject(AuthService);
  private xpService = inject(XpService);

  private xpLoader = effect(() => {
    if (this.auth.currentUser()) this.xpService.loadXp();
  });
}
