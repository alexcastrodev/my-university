import { Module } from '@nestjs/common';
import { loadStorageConfig } from './storage.config';
import { StorageService } from './storage.service';

// Not imported by AppModule yet: a feature module that needs files imports this one, and the S3
// settings are validated when it does (the first consumer is the paper PDF upload).
@Module({
  providers: [
    {
      provide: StorageService,
      useFactory: () => new StorageService(loadStorageConfig()),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
