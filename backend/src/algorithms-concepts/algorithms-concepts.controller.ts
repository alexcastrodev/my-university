import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  AlgorithmsConceptDetail,
  AlgorithmsConceptsService,
  AlgorithmsConceptSummary,
} from './algorithms-concepts.service';

@Controller('algorithms-concepts')
export class AlgorithmsConceptsController extends ConceptsControllerBase<
  AlgorithmsConceptSummary,
  AlgorithmsConceptDetail
> {
  constructor(service: AlgorithmsConceptsService, xp: XpService) {
    super(service, xp, 'algo');
  }
}
