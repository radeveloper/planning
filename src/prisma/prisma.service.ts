import {INestApplication, Injectable, OnModuleDestroy, OnModuleInit} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService extends PrismaClient and hooks into the Nest lifecycle.
 * On module initialization it can connect to the database. It also
 * provides a helper for enabling graceful shutdown when the process
 * receives a termination signal.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    // Prisma 5 + Node-API (library engine) için doğru yöntem:
    async enableShutdownHooks(app: INestApplication) {
        process.on('beforeExit', async () => {
            await app.close();
        });
    }
}
