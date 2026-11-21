import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  DotnetClientAppsConceptDetail,
  DotnetClientAppsConceptsService,
  DotnetClientAppsConceptSummary,
} from './dotnet-client-apps-concepts.service';

@Controller('dotnet-client-apps-concepts')
export class DotnetClientAppsConceptsController extends ConceptsControllerBase<
  DotnetClientAppsConceptSummary,
  DotnetClientAppsConceptDetail
> {
  constructor(service: DotnetClientAppsConceptsService, xp: XpService) {
    super(service, xp, 'dotnet-client-apps');
  }
}
