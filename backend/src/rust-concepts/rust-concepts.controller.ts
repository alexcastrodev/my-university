import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  RustConceptDetail,
  RustConceptsService,
  RustConceptSummary,
} from './rust-concepts.service';

@Controller('rust-concepts')
export class RustConceptsController extends ConceptsControllerBase<
  RustConceptSummary,
  RustConceptDetail
> {
  constructor(service: RustConceptsService, xp: XpService) {
    super(service, xp, 'rust');
  }
}
