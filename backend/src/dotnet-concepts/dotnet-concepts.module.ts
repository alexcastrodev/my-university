import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { DotNetConceptsController } from './dotnet-concepts.controller';
import { DotNetConceptsService } from './dotnet-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [DotNetConceptsController],
  providers: [DotNetConceptsService],
  exports: [DotNetConceptsService],
})
export class DotNetConceptsModule {}
