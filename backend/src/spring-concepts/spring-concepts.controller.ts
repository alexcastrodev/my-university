import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { SpringConceptsService } from './spring-concepts.service';

@Controller('spring-concepts')
export class SpringConceptsController extends ConceptsControllerBase<
  ReturnType<SpringConceptsService['findAll']>[number],
  NonNullable<ReturnType<SpringConceptsService['findBySlug']>>
> {
  constructor(service: SpringConceptsService, xp: XpService) {
    super(service, xp, 'spring');
  }
}
