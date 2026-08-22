import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { QuarkusConceptsController } from './quarkus-concepts.controller';
import { QuarkusConceptsService } from './quarkus-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [QuarkusConceptsController],
  providers: [QuarkusConceptsService],
  exports: [QuarkusConceptsService],
})
export class QuarkusConceptsModule {}
