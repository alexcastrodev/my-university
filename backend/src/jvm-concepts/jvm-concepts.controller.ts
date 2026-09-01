import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { JvmConceptsService } from './jvm-concepts.service';

@Controller('jvm-concepts')
export class JvmConceptsController extends ConceptsControllerBase<
  ReturnType<JvmConceptsService['findAll']>[number],
  NonNullable<ReturnType<JvmConceptsService['findBySlug']>>
> {
  constructor(service: JvmConceptsService, xp: XpService) {
    super(service, xp, 'jvm');
  }
}
