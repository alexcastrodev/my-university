import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { TestingConceptsService } from './testing-concepts.service';

@Controller('testing-concepts')
export class TestingConceptsController extends ConceptsControllerBase<
  ReturnType<TestingConceptsService['findAll']>[number],
  NonNullable<ReturnType<TestingConceptsService['findBySlug']>>
> {
  constructor(service: TestingConceptsService, xp: XpService) {
    super(service, xp, 'testing');
  }
}
