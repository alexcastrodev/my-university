import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { KurzModule } from '../kurz/kurz.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, AiModule, KurzModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
