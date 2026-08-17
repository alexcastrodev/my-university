import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { RubyConceptsController } from './ruby-concepts.controller';
import { RubyConceptsService } from './ruby-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [RubyConceptsController],
  providers: [RubyConceptsService],
  exports: [RubyConceptsService],
})
export class RubyConceptsModule {}
