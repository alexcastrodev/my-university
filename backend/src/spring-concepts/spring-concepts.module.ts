import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { SpringConceptsController } from './spring-concepts.controller';
import { SpringConceptsService } from './spring-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [SpringConceptsController],
  providers: [SpringConceptsService],
  exports: [SpringConceptsService],
})
export class SpringConceptsModule {}
