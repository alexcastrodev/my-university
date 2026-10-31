import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Module,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { loadStorageConfig } from '../src/storage/storage.config';
import { StorageService } from '../src/storage/storage.service';

// A throwaway Nest server that exposes StorageService over HTTP, so storage.spec.ts can test it the
// way every other spec does: send a request, assert on the response. It lives in spec/ because no
// production endpoint uses storage yet; the paper upload feature will bring the real ones.

/** Maps storage failures to HTTP: a bad argument is a 400, anything the S3 server refused is a 502. */
async function respond<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof HttpException) throw err;
    if (err instanceof RangeError) throw new BadRequestException(err.message);
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    throw new BadGatewayException({ upstreamStatus: status ?? null });
  }
}

const seconds = (value?: string) =>
  value === undefined ? undefined : Number(value);

@Controller('storage')
class StorageHarnessController {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  @Post('objects')
  upload(@Body() body: { content: string; contentType: string }) {
    return respond(async () => {
      const key = this.storage.newKey('spec');
      await this.storage.put(key, Buffer.from(body.content), body.contentType);
      return { key };
    });
  }

  @Get('objects/meta')
  meta(@Query('key') key: string) {
    return respond(async () => {
      const meta = await this.storage.head(key);
      if (!meta) throw new NotFoundException();
      return meta;
    });
  }

  @Delete('objects')
  @HttpCode(204)
  remove(@Query('key') key: string) {
    return respond(() => this.storage.delete(key));
  }

  @Get('presign-get')
  presignGet(
    @Query('key') key: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    return respond(async () => ({
      url: await this.storage.presignGet(key, seconds(expiresIn)),
    }));
  }

  @Get('presign-put')
  presignPut(
    @Query('contentType') contentType: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    return respond(async () => {
      const key = this.storage.newKey('spec');
      return {
        key,
        url: await this.storage.presignPut(
          key,
          contentType,
          seconds(expiresIn),
        ),
      };
    });
  }
}

export interface StorageApp {
  url: string;
  close: () => Promise<void>;
}

/** Boots the server on a free port with the given S3_* settings (the process environment by default). */
export async function startStorageApp(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StorageApp> {
  @Module({
    controllers: [StorageHarnessController],
    providers: [
      {
        provide: StorageService,
        useValue: new StorageService(loadStorageConfig(env)),
      },
    ],
  })
  class StorageHarnessModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    StorageHarnessModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { url: `${await app.getUrl()}/api`, close: () => app.close() };
}
