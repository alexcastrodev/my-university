import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  IdentityConceptDetail,
  IdentityConceptsService,
  IdentityConceptSummary,
} from './identity-concepts.service';

@Controller('identity-concepts')
export class IdentityConceptsController extends ConceptsControllerBase<
  IdentityConceptSummary,
  IdentityConceptDetail
> {
  constructor(service: IdentityConceptsService, xp: XpService) {
    super(service, xp, 'identity');
  }
}
