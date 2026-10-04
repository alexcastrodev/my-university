import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  CSharpConceptDetail,
  CSharpConceptsService,
  CSharpConceptSummary,
} from './csharp-concepts.service';

@Controller('csharp-concepts')
export class CSharpConceptsController extends ConceptsControllerBase<
  CSharpConceptSummary,
  CSharpConceptDetail
> {
  constructor(service: CSharpConceptsService, xp: XpService) {
    super(service, xp, 'csharp');
  }
}
