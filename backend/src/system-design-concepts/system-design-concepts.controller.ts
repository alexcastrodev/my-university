import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import { SystemDesignConceptsService } from './system-design-concepts.service';

@Controller('system-design-concepts')
export class SystemDesignConceptsController extends ConceptsControllerBase<
  ReturnType<SystemDesignConceptsService['findAll']>[number],
  NonNullable<ReturnType<SystemDesignConceptsService['findBySlug']>>
> {
  constructor(service: SystemDesignConceptsService, xp: XpService) {
    super(service, xp, 'sysdesign');
  }
}
