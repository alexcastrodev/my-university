import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { CSharpConceptsController } from './csharp-concepts.controller';
import { CSharpConceptsService } from './csharp-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [CSharpConceptsController],
  providers: [CSharpConceptsService],
  exports: [CSharpConceptsService],
})
export class CSharpConceptsModule {}
