import { Controller, Get, Header, Query } from '@nestjs/common';
import { OgImageService } from './og-image.service';

@Controller('og')
export class OgImageController {
  constructor(private service: OgImageService) {}

  @Get()
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=86400')
  async render(@Query('title') title?: string): Promise<Buffer> {
    return this.service.render(title);
  }
}
