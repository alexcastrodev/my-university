import { ChangeDetectionStrategy, Component, OnInit, inject, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { XpToast } from './components/xp-toast/xp-toast';
import { AskAiTooltip } from './components/ask-ai-tooltip/ask-ai-tooltip';
import { AuthService } from './services/auth.service';
import { XpService } from './services/xp.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Header, Footer, XpToast, AskAiTooltip, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private auth = inject(AuthService);
  private xpService = inject(XpService);

  private xpLoader = effect(() => {
    if (this.auth.currentUser()) this.xpService.loadSummary();
  });

  ngOnInit(): void {
    this.auth.bootstrap();
  }
}
