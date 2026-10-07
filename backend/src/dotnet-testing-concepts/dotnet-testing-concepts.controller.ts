import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  DotNetTestingConceptDetail,
  DotNetTestingConceptsService,
  DotNetTestingConceptSummary,
} from './dotnet-testing-concepts.service';

@Controller('dotnet-testing-concepts')
export class DotNetTestingConceptsController extends ConceptsControllerBase<
  DotNetTestingConceptSummary,
  DotNetTestingConceptDetail
> {
  constructor(service: DotNetTestingConceptsService, xp: XpService) {
    super(service, xp, 'dotnet-testing');
  }
}
