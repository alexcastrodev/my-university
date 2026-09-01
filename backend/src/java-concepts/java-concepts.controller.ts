import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  JavaConceptDetail,
  JavaConceptsService,
  JavaConceptSummary,
} from './java-concepts.service';

@Controller('java-concepts')
export class JavaConceptsController extends ConceptsControllerBase<
  JavaConceptSummary,
  JavaConceptDetail
> {
  constructor(service: JavaConceptsService, xp: XpService) {
    super(service, xp, '');
  }
}
