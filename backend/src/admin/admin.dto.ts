import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PERMISSIONS } from '../auth/permissions';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A role is a name and what it holds. A role that holds nothing makes no sense, so the list cannot be empty. */
export class CreateRoleDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions: string[];

  /** Credits a user of this role may spend in any 24 hours. Changing it needs `ai_credits.grant`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiDailyCreditLimit?: number;
}

export class UpdateRoleDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(PERMISSIONS, { each: true })
  permissions: string[];

  /** Credits a user of this role may spend in any 24 hours. Changing it needs `ai_credits.grant`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  aiDailyCreditLimit?: number;
}

export class SetUserRolesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds: number[];
}

export const USERS_PAGE_SIZE = 25;

export class UsersQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
}

export class GrantCreditsDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount: number;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  reason: string;
}

export class ReverseGrantDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  reason: string;
}
