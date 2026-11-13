import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  GoConceptDetail,
  GoConceptsService,
  GoConceptSummary,
} from './go-concepts.service';

@Controller('go-concepts')
export class GoConceptsController extends ConceptsControllerBase<
  GoConceptSummary,
  GoConceptDetail
> {
  constructor(service: GoConceptsService, xp: XpService) {
    super(service, xp, 'go');
  }
}
