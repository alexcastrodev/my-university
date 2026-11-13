import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { GoConceptsController } from './go-concepts.controller';
import { GoConceptsService } from './go-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [GoConceptsController],
  providers: [GoConceptsService],
  exports: [GoConceptsService],
})
export class GoConceptsModule {}
