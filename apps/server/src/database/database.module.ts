import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { allEntities } from './data-source';
import { CompanyIdSubscriber } from '../common/tenant/company-id.subscriber';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'better-sqlite3' as const,
        database: process.env.DATABASE_PATH ?? './data/pms.db',
        entities: allEntities,
        synchronize: (process.env.DB_AUTO_SYNC ?? 'true') === 'true',
        autoLoadEntities: false,
        subscribers: [CompanyIdSubscriber],
        logging: false,
        extra: {
          pragmaJournalMode: 'WAL',
          pragmaBusyTimeout: 5000,
        },
      }),
    }),
    TypeOrmModule.forFeature(allEntities),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}