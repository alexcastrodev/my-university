import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { Paper } from './paper.entity';

/** Any UUID, case-insensitive: the shape of `paper.publicId`. Anything else is not a paper. */
const PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id a paper had before #202: digits only. Papers are addressed by it no more, but old links exist. */
const LEGACY_ID = /^[1-9]\d{0,9}$/;

export const isPublicId = (value: unknown): value is string =>
  typeof value === 'string' && PUBLIC_ID.test(value);

export const isLegacyId = (value: unknown): value is string =>
  typeof value === 'string' &&
  LEGACY_ID.test(value) &&
  Number(value) <= 2_147_483_647;

/**
 * Turns the public id a route names into the internal key the services use. Malformed and unknown ids are
 * the same 404, so a caller learns nothing by trying.
 *
 * It is a service the handlers call, not a route pipe: a pipe would run after the global ValidationPipe,
 * which turns a param typed `number` into NaN before the pipe sees it.
 */
@Injectable()
export class PaperIds {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** A public paper. A private one (#203) is the same 404 as an id that does not exist. */
  async resolve(publicId: string): Promise<number> {
    return this.find(publicId, [{ ownerId: IsNull() }]);
  }

  /** What a reader may reach: a public paper, or one of their own private papers. Anyone else's is a 404. */
  async resolveFor(userId: number, publicId: string): Promise<number> {
    return this.find(publicId, [{ ownerId: IsNull() }, { ownerId: userId }]);
  }

  private async find(
    publicId: string,
    owners: { ownerId: ReturnType<typeof IsNull> | number }[],
  ): Promise<number> {
    if (!isPublicId(publicId)) throw new NotFoundException();
    const paper = await this.dataSource.getRepository(Paper).findOne({
      where: owners.map((o) => ({ ...o, publicId: publicId.toLowerCase() })),
      select: { id: true },
    });
    if (!paper) throw new NotFoundException();
    return paper.id;
  }
}
