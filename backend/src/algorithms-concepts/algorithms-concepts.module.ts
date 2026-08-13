import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { AlgorithmsConceptsController } from './algorithms-concepts.controller';
import { AlgorithmsConceptsService } from './algorithms-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [AlgorithmsConceptsController],
  providers: [AlgorithmsConceptsService],
  exports: [AlgorithmsConceptsService],
})
export class AlgorithmsConceptsModule {}
