import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  RubyOnRailsConceptDetail,
  RubyOnRailsConceptsService,
  RubyOnRailsConceptSummary,
} from './rubyonrails-concepts.service';

@Controller('rubyonrails-concepts')
export class RubyOnRailsConceptsController extends ConceptsControllerBase<
  RubyOnRailsConceptSummary,
  RubyOnRailsConceptDetail
> {
  constructor(service: RubyOnRailsConceptsService, xp: XpService) {
    super(service, xp, 'rails');
  }
}
