import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { JavaConceptsController } from './java-concepts.controller';
import { JavaConceptsService } from './java-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [JavaConceptsController],
  providers: [JavaConceptsService],
  exports: [JavaConceptsService],
})
export class JavaConceptsModule {}
