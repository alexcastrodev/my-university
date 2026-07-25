import { Module } from '@nestjs/common';
import { JavaConceptsController } from './java-concepts.controller';
import { JavaConceptsService } from './java-concepts.service';

@Module({
  controllers: [JavaConceptsController],
  providers: [JavaConceptsService],
  exports: [JavaConceptsService],
})
export class JavaConceptsModule {}
