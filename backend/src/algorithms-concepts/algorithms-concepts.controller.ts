import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { AlgorithmsConceptsService } from './algorithms-concepts.service';

@Controller('algorithms-concepts')
export class AlgorithmsConceptsController extends ConceptsControllerBase<
  ReturnType<AlgorithmsConceptsService['findAll']>[number],
  NonNullable<ReturnType<AlgorithmsConceptsService['findBySlug']>>
> {
  constructor(service: AlgorithmsConceptsService, xp: XpService) {
    super(service, xp, 'algo');
  }
}
