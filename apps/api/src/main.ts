import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3333;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Canal Direto API rodando em http://localhost:${port}/api`);
}

bootstrap();
