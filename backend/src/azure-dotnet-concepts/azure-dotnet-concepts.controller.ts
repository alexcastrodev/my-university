import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  AzureDotnetConceptDetail,
  AzureDotnetConceptsService,
  AzureDotnetConceptSummary,
} from './azure-dotnet-concepts.service';

@Controller('azure-dotnet-concepts')
export class AzureDotnetConceptsController extends ConceptsControllerBase<
  AzureDotnetConceptSummary,
  AzureDotnetConceptDetail
> {
  constructor(service: AzureDotnetConceptsService, xp: XpService) {
    super(service, xp, 'azure-dotnet');
  }
}
