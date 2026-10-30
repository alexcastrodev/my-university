import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  DotNetAiConceptDetail,
  DotNetAiConceptsService,
  DotNetAiConceptSummary,
} from './dotnet-ai-concepts.service';

@Controller('dotnet-ai-concepts')
export class DotNetAiConceptsController extends ConceptsControllerBase<
  DotNetAiConceptSummary,
  DotNetAiConceptDetail
> {
  constructor(service: DotNetAiConceptsService, xp: XpService) {
    super(service, xp, 'dotnet-ai');
  }
}
