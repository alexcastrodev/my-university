import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { RubyConceptsService } from './ruby-concepts.service';

@Controller('ruby-concepts')
export class RubyConceptsController extends ConceptsControllerBase<
  ReturnType<RubyConceptsService['findAll']>[number],
  NonNullable<ReturnType<RubyConceptsService['findBySlug']>>
> {
  constructor(service: RubyConceptsService, xp: XpService) {
    super(service, xp, 'ruby');
  }
}
