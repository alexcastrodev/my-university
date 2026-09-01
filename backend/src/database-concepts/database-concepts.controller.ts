import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  DatabaseConceptDetail,
  DatabaseConceptsService,
  DatabaseConceptSummary,
} from './database-concepts.service';

@Controller('database-concepts')
export class DatabaseConceptsController extends ConceptsControllerBase<
  DatabaseConceptSummary,
  DatabaseConceptDetail
> {
  constructor(service: DatabaseConceptsService, xp: XpService) {
    super(service, xp, 'db');
  }
}
