import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { JvmConceptsController } from './jvm-concepts.controller';
import { JvmConceptsService } from './jvm-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [JvmConceptsController],
  providers: [JvmConceptsService],
  exports: [JvmConceptsService],
})
export class JvmConceptsModule {}
