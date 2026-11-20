import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { AzureDotnetConceptsController } from './azure-dotnet-concepts.controller';
import { AzureDotnetConceptsService } from './azure-dotnet-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [AzureDotnetConceptsController],
  providers: [AzureDotnetConceptsService],
  exports: [AzureDotnetConceptsService],
})
export class AzureDotnetConceptsModule {}
