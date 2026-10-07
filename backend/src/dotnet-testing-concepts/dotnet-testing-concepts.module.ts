import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { DotNetTestingConceptsController } from './dotnet-testing-concepts.controller';
import { DotNetTestingConceptsService } from './dotnet-testing-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [DotNetTestingConceptsController],
  providers: [DotNetTestingConceptsService],
  exports: [DotNetTestingConceptsService],
})
export class DotNetTestingConceptsModule {}
