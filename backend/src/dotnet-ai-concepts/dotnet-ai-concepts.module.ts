import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { DotNetAiConceptsController } from './dotnet-ai-concepts.controller';
import { DotNetAiConceptsService } from './dotnet-ai-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [DotNetAiConceptsController],
  providers: [DotNetAiConceptsService],
  exports: [DotNetAiConceptsService],
})
export class DotNetAiConceptsModule {}
