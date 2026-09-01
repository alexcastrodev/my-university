import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { DatabaseConceptsService } from './database-concepts.service';

@Controller('database-concepts')
export class DatabaseConceptsController extends ConceptsControllerBase<
  ReturnType<DatabaseConceptsService['findAll']>[number],
  NonNullable<ReturnType<DatabaseConceptsService['findBySlug']>>
> {
  constructor(service: DatabaseConceptsService, xp: XpService) {
    super(service, xp, 'db');
  }
}
