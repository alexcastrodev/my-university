import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  SystemDesignConceptDetail,
  SystemDesignConceptsService,
  SystemDesignConceptSummary,
} from './system-design-concepts.service';

@Controller('system-design-concepts')
export class SystemDesignConceptsController extends ConceptsControllerBase<
  SystemDesignConceptSummary,
  SystemDesignConceptDetail
> {
  constructor(service: SystemDesignConceptsService, xp: XpService) {
    super(service, xp, 'sysdesign');
  }
}
