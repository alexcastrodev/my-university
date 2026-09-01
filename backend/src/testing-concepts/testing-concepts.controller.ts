import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  TestingConceptDetail,
  TestingConceptsService,
  TestingConceptSummary,
} from './testing-concepts.service';

@Controller('testing-concepts')
export class TestingConceptsController extends ConceptsControllerBase<
  TestingConceptSummary,
  TestingConceptDetail
> {
  constructor(service: TestingConceptsService, xp: XpService) {
    super(service, xp, 'testing');
  }
}
