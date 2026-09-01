import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { QuarkusConceptsService } from './quarkus-concepts.service';

@Controller('quarkus-concepts')
export class QuarkusConceptsController extends ConceptsControllerBase<
  ReturnType<QuarkusConceptsService['findAll']>[number],
  NonNullable<ReturnType<QuarkusConceptsService['findBySlug']>>
> {
  constructor(service: QuarkusConceptsService, xp: XpService) {
    super(service, xp, 'quarkus');
  }
}
