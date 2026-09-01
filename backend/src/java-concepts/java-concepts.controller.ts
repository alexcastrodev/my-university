import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { JavaConceptsService } from './java-concepts.service';

@Controller('java-concepts')
export class JavaConceptsController extends ConceptsControllerBase<
  ReturnType<JavaConceptsService['findAll']>[number],
  NonNullable<ReturnType<JavaConceptsService['findBySlug']>>
> {
  constructor(service: JavaConceptsService, xp: XpService) {
    super(service, xp, '');
  }
}
