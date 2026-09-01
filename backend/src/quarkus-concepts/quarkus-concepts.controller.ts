import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  QuarkusConceptDetail,
  QuarkusConceptsService,
  QuarkusConceptSummary,
} from './quarkus-concepts.service';

@Controller('quarkus-concepts')
export class QuarkusConceptsController extends ConceptsControllerBase<
  QuarkusConceptSummary,
  QuarkusConceptDetail
> {
  constructor(service: QuarkusConceptsService, xp: XpService) {
    super(service, xp, 'quarkus');
  }
}
