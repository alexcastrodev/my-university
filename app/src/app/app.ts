import { ChangeDetectionStrategy, Component, OnInit, inject, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { BottomNav } from './components/bottom-nav/bottom-nav';
import { XpToast } from './components/xp-toast/xp-toast';
import { ChunkReloadToast } from './components/chunk-reload-toast/chunk-reload-toast';
import { AskAiTooltip } from './components/ask-ai-tooltip/ask-ai-tooltip';
import { MermaidViewer } from './components/mermaid-viewer/mermaid-viewer';
import { AuthService } from './services/auth.service';
import { XpService } from './services/xp.service';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Header, Footer, BottomNav, XpToast, ChunkReloadToast, AskAiTooltip, MermaidViewer, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private auth = inject(AuthService);
  private xpService = inject(XpService);
  // Instantiated here (not lazily on first use elsewhere) so its data-theme
  // attribute effect runs as early as possible in the app's lifetime.
  private theme = inject(ThemeService);

  private xpLoader = effect(() => {
    if (this.auth.currentUser()) this.xpService.loadSummary();
  });

  ngOnInit(): void {
    this.auth.bootstrap();
  }
}
