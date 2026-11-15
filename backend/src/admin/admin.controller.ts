import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RequirePermission } from '../auth/permission.guard';
import { CurrentUserId } from '../auth/session';
import {
  CreateRoleDto,
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
  constructor(private service: AdminService) {}

  @Get('roles')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('admin.access')
  roles() {
    return this.service.listRoles();
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  createRole(@CurrentUserId() actor: number, @Body() dto: CreateRoleDto) {
    return this.service.createRole(actor, dto.name, dto.permissions);
  }

  @Put('roles/:id')
  @RequirePermission('roles.manage')
  updateRole(
    @CurrentUserId() actor: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.updateRole(actor, id, dto.permissions);
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
}
