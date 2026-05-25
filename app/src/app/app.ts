import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';

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
export class App {}
