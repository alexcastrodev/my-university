import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../auth/permission.guard';
import { AiCreditsService } from '../ai/ai-credits.service';
import { PlatformBudgetService } from '../ai/platform-budget.service';
import { CurrentUserId } from '../auth/session';
import {
  CreateRoleDto,
  GrantCreditsDto,
  ReverseGrantDto,
  SetUserRolesDto,
  UpdateRoleDto,
  UsersQueryDto,
} from './admin.dto';
import { AdminService } from './admin.service';

/**
 * The admin area (#322). Every route names the permission it needs with `@RequirePermission`, and a spec fails
 * if one does not. Nothing here is cached: it is per-admin and changes by the minute.
 */
@Controller('admin')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class AdminController {
  constructor(
    private service: AdminService,
    private credits: AiCreditsService,
    private budget: PlatformBudgetService,
  ) {}

  @Get('roles')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('admin.access')
  roles() {
    return this.service.listRoles();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(@CurrentUserId() actor: number, @Body() dto: CreateRoleDto) {
    return this.service.createRole(
      actor,
      dto.name,
      dto.permissions,
      dto.aiDailyCreditLimit,
    );
  }

  @Put('roles/:id')
  @RequirePermission('roles.manage')
  updateRole(
    @CurrentUserId() actor: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.updateRole(
      actor,
      id,
      dto.permissions,
      dto.aiDailyCreditLimit,
    );
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('roles.manage')
  async deleteRole(
    @CurrentUserId() actor: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.service.deleteRole(actor, id);
  }

  @Get('users')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('users.view')
  users(@Query() query: UsersQueryDto) {
    return this.service.listUsers(query.q, query.page);
  }

  @Put('users/:id/roles')
  @RequirePermission('roles.manage')
  setUserRoles(
    @CurrentUserId() actor: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.service.setUserRoles(actor, id, dto.roleIds);
  }

  @Get('audit')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('admin.access')
  audit() {
    return this.service.recentAudit();
  }

  /** A user's balance, the grants that made it, and what they used per day. */
  @Get('users/:id/credits')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('users.view')
  userCredits(@Param('id', ParseIntPipe) id: number) {
    return this.credits.summary(id);
  }

  @Post('users/:id/credits')
  @RequirePermission('ai_credits.grant')
  grantCredits(
    @CurrentUserId() actor: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GrantCreditsDto,
  ) {
    return this.credits.grant(actor, id, dto.amount, dto.reason);
  }

  @Post('credits/:grantId/reverse')
  @RequirePermission('ai_credits.reverse')
  reverseGrant(
    @CurrentUserId() actor: number,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: ReverseGrantDto,
  ) {
    return this.credits.reverse(actor, grantId, dto.reason);
  }

  /** What the platform has spent on the model today and this month, in US$, against its budget. */
  @Get('ai/budget')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('admin.access')
  platformBudget() {
    return this.budget.adminView();
  }
}
