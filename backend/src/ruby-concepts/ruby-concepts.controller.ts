import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  RubyConceptDetail,
  RubyConceptsService,
  RubyConceptSummary,
} from './ruby-concepts.service';

@Controller('ruby-concepts')
export class RubyConceptsController extends ConceptsControllerBase<
  RubyConceptSummary,
  RubyConceptDetail
> {
  constructor(service: RubyConceptsService, xp: XpService) {
    super(service, xp, 'ruby');
  }
}
