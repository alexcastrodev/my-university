import { Controller, Get, Header } from '@nestjs/common';
import { SitemapService } from './sitemap.service';

@Controller()
export class SitemapController {
  constructor(private service: SitemapService) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async sitemap(): Promise<string> {
    return this.service.toXml();
  }
}
