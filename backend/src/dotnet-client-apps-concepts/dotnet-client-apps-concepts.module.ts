import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { DotnetClientAppsConceptsController } from './dotnet-client-apps-concepts.controller';
import { DotnetClientAppsConceptsService } from './dotnet-client-apps-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [DotnetClientAppsConceptsController],
  providers: [DotnetClientAppsConceptsService],
  exports: [DotnetClientAppsConceptsService],
})
export class DotnetClientAppsConceptsModule {}
