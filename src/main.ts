import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    // WS adapter’ı kaydet (yeterli)
    app.useWebSocketAdapter(new IoAdapter(app));

    // Graceful shutdown
    const prisma = app.get(PrismaService);
    await prisma.enableShutdownHooks(app);

    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Server listening on port ${port}`);
}

bootstrap().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});
