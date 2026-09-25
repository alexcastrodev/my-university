import { Controller } from '@nestjs/common';
import { ConceptsControllerBase } from '../shared/concepts-controller.base';
import { XpService } from '../xp/xp.service';
import {
  KubernetesConceptDetail,
  KubernetesConceptsService,
  KubernetesConceptSummary,
} from './kubernetes-concepts.service';

@Controller('kubernetes-concepts')
export class KubernetesConceptsController extends ConceptsControllerBase<
  KubernetesConceptSummary,
  KubernetesConceptDetail
> {
  constructor(service: KubernetesConceptsService, xp: XpService) {
    super(service, xp, 'kubernetes');
  }
}
