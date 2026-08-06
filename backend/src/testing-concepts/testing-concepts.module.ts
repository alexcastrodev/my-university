import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { TestingConceptsController } from './testing-concepts.controller';
import { TestingConceptsService } from './testing-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [TestingConceptsController],
  providers: [TestingConceptsService],
  exports: [TestingConceptsService],
})
export class TestingConceptsModule {}
