import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  JvmConceptDetail,
  JvmConceptsService,
  JvmConceptSummary,
} from './jvm-concepts.service';

@Controller('jvm-concepts')
export class JvmConceptsController extends ConceptsControllerBase<
  JvmConceptSummary,
  JvmConceptDetail
> {
  constructor(service: JvmConceptsService, xp: XpService) {
    super(service, xp, 'jvm');
  }
}
