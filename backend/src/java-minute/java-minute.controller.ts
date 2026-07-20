import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { JavaMinuteService } from './java-minute.service';

@Controller('java-minute')
export class JavaMinuteController {
  constructor(private service: JavaMinuteService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    const episode = this.service.findBySlug(slug);
    if (!episode) throw new NotFoundException();
    return episode;
  }
}
