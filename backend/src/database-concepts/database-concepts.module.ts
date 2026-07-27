import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { DatabaseConceptsController } from './database-concepts.controller';
import { DatabaseConceptsService } from './database-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [DatabaseConceptsController],
  providers: [DatabaseConceptsService],
  exports: [DatabaseConceptsService],
})
export class DatabaseConceptsModule {}
