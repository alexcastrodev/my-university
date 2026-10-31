import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { GIVEN_ROLES } from './paper-group-access';

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 500;
export const POST_MAX = 5000;

const NO_NUL = /^[^\0]*$/;

/** Creating a group. The service trims and cleans the name and refuses a blank one. */
export class CreateGroupDto {
  @IsString()
  @MaxLength(GROUP_NAME_MAX)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(GROUP_DESCRIPTION_MAX)
  description?: string;
}

/** Changing a group: what is left out stays; an empty description clears it. */
export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(GROUP_NAME_MAX)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(GROUP_DESCRIPTION_MAX)
  description?: string;
}

/** Whom to invite: the public profile they already give out (vanity slug, profile id or the `/u/...` link). */
export class InviteDto {
  @IsString()
  @MaxLength(200)
  @Matches(NO_NUL)
  user: string;
}

export class RoleDto {
  @IsIn(GIVEN_ROLES)
  role: (typeof GIVEN_ROLES)[number];
}

export class PostDto {
  @IsString()
  @MaxLength(POST_MAX)
  @Matches(NO_NUL)
  body: string;

  /** The group paper a post is about; none for a post to the group. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paper?: string;
}
