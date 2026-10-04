import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  DotNetConceptDetail,
  DotNetConceptsService,
  DotNetConceptSummary,
} from './dotnet-concepts.service';

@Controller('dotnet-concepts')
export class DotNetConceptsController extends ConceptsControllerBase<
  DotNetConceptSummary,
  DotNetConceptDetail
> {
  constructor(service: DotNetConceptsService, xp: XpService) {
    super(service, xp, 'dotnet');
  }
}
