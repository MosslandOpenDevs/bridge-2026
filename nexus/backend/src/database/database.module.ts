import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  SignalEntity,
  ProposalEntity,
  ProposalResultEntity,
  VoteEntity,
  DelegationPolicyEntity,
  OutcomeEntity,
} from '../entities';

/**
 * Every entity the application maps. Both connection shapes below share this
 * one list so an entity cannot be registered for the DATABASE_URL path and
 * forgotten on the discrete-variable path, which fails only at boot and only
 * for whichever configuration the deployment happens to use.
 */
const ENTITIES = [
  SignalEntity,
  ProposalEntity,
  ProposalResultEntity,
  VoteEntity,
  DelegationPolicyEntity,
  OutcomeEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        
        if (databaseUrl) {
          // PostgreSQL URL 형식: postgresql://user:password@host:port/database
          return {
            type: 'postgres',
            url: databaseUrl,
            entities: ENTITIES,
            synchronize: configService.get<string>('NODE_ENV') === 'development',
            logging: configService.get<string>('NODE_ENV') === 'development',
          };
        }

        // Fallback: 환경 변수로부터 개별 설정
        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'bridge2026'),
          entities: ENTITIES,
          synchronize: configService.get<string>('NODE_ENV') === 'development',
          logging: configService.get<string>('NODE_ENV') === 'development',
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}









