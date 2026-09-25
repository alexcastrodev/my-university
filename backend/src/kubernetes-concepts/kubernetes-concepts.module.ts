import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { KubernetesConceptsController } from './kubernetes-concepts.controller';
import { KubernetesConceptsService } from './kubernetes-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [KubernetesConceptsController],
  providers: [KubernetesConceptsService],
  exports: [KubernetesConceptsService],
})
export class KubernetesConceptsModule {}
