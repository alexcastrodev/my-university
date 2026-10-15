import { Controller, Get } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { ConceptLookupService } from './concept-lookup.service';

@Controller('activity')
export class ConceptLookupController {
  constructor(private lookup: ConceptLookupService) {}

  @Get('recent')
  getRecentActivity(@CurrentUserId() userId: number) {
    return this.lookup.getRecentActivity(userId);
  }
}
