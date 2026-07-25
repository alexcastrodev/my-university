import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { JavaConceptsService } from './java-concepts.service';

@Controller('java-concepts')
export class JavaConceptsController {
  constructor(private service: JavaConceptsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    return concept;
  }
}
