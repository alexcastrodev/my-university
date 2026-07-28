import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { SystemDesignConceptsController } from './system-design-concepts.controller';
import { SystemDesignConceptsService } from './system-design-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [SystemDesignConceptsController],
  providers: [SystemDesignConceptsService],
  exports: [SystemDesignConceptsService],
})
export class SystemDesignConceptsModule {}
