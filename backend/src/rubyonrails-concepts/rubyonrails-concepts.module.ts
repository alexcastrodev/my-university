import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { RubyOnRailsConceptsController } from './rubyonrails-concepts.controller';
import { RubyOnRailsConceptsService } from './rubyonrails-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [RubyOnRailsConceptsController],
  providers: [RubyOnRailsConceptsService],
  exports: [RubyOnRailsConceptsService],
})
export class RubyOnRailsConceptsModule {}
