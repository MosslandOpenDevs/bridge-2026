import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Secure HTTP headers (CSP off by default for API-only responses).
  app.use(helmet());

  // Global rate limit to blunt naive flooding / brute force. Env-tunable.
  const rateLimitMax = parseInt(process.env.RATE_LIMIT_GLOBAL || '120', 10);
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    }),
  );

  // CORS: restrict to the configured frontend origin.
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Validation 파이프
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`🚀 BRIDGE 2026 API Server running on http://localhost:${port}`);
  console.log(`📡 Endpoints:`);
  console.log(`   - GET    /health                          - Health check`);
  console.log(`   - GET    /api/signals                     - List signals`);
  console.log(`   - POST   /api/signals/collect             - Collect signals`);
  console.log(`   - GET    /api/proposals                   - List proposals`);
  console.log(`   - GET    /api/proposals/:id               - Get proposal`);
  console.log(`   - POST   /api/proposals/:id/vote          - Cast vote (wallet signature)`);
  console.log(`   - POST   /api/proposals/:id/tally         - Tally votes`);
  console.log(`   - GET    /api/delegation/policies         - List delegation policies`);
  console.log(`   - POST   /api/delegation/policies         - Create policy (wallet signature)`);
  console.log(`   - DELETE /api/delegation/policies/:id     - Delete policy (wallet signature)`);
  console.log(`   - GET    /api/outcomes                    - List outcomes`);
  console.log(`   - GET    /api/outcomes/:id                - Get outcome`);
  console.log(`   - GET    /api/blockchain/balance/:address - Moss Coin balance`);
  console.log(`   - GET    /api/blockchain/total-supply     - Moss Coin total supply`);
  console.log(`   - GET    /api/blockchain/transaction/:txHash - Look up a transaction`);
}

bootstrap();









