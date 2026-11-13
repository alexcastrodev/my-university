import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { RustConceptsController } from './rust-concepts.controller';
import { RustConceptsService } from './rust-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [RustConceptsController],
  providers: [RustConceptsService],
  exports: [RustConceptsService],
})
export class RustConceptsModule {}
