import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  SpringConceptDetail,
  SpringConceptsService,
  SpringConceptSummary,
} from './spring-concepts.service';

@Controller('spring-concepts')
export class SpringConceptsController extends ConceptsControllerBase<
  SpringConceptSummary,
  SpringConceptDetail
> {
  constructor(service: SpringConceptsService, xp: XpService) {
    super(service, xp, 'spring');
  }
}
