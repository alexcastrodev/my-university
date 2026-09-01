import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { RubyOnRailsConceptsService } from './rubyonrails-concepts.service';

@Controller('rubyonrails-concepts')
export class RubyOnRailsConceptsController extends ConceptsControllerBase<
  ReturnType<RubyOnRailsConceptsService['findAll']>[number],
  NonNullable<ReturnType<RubyOnRailsConceptsService['findBySlug']>>
> {
  constructor(service: RubyOnRailsConceptsService, xp: XpService) {
    super(service, xp, 'rails');
  }
}
