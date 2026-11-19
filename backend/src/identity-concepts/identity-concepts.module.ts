import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { IdentityConceptsController } from './identity-concepts.controller';
import { IdentityConceptsService } from './identity-concepts.service';

@Module({
  imports: [XpModule],
  controllers: [IdentityConceptsController],
  providers: [IdentityConceptsService],
  exports: [IdentityConceptsService],
})
export class IdentityConceptsModule {}
