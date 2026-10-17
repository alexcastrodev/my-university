import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { XpService } from '../xp/xp.service';
import { OgImageService } from './og-image.service';

@Controller('og')
export class OgImageController {
  constructor(
    private service: OgImageService,
    private xp: XpService,
  ) {}

  @Get()
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  async render(@Query('title') title?: string): Promise<Buffer> {
    return this.service.render(title);
  }

  /**
   * Share image of a public learner profile. A private or unknown profile gets the generic image, so
   * the response never reveals that someone exists; the short cache lets going private take effect fast.
   */
  @Get('profile/:key')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=300')
  async renderProfile(@Param('key') key: string): Promise<Buffer> {
    const profile = await this.xp.getPublicProfile(key);
    if (!profile) return this.service.render(undefined);
    const subtitle = `Level ${profile.level.number} ${profile.level.title} · ${profile.badges.length} badges · ${profile.trophies.length} trophies`;
    return this.service.render(profile.displayName, subtitle);
  }
}
