import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { PokerGateway } from './ws/poker.gateway';

/**
 * Root application module. Registers feature modules and global
 * configuration. Additional infrastructure modules should be
 * imported here.
 */
@Module({
  imports: [
    // Loads environment variables from `.env` file and validates
    // required variables. Modules can inject ConfigService to read
    // values.
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    RoomsModule,
  ],
  controllers: [],
  providers: [PokerGateway],
})
export class AppModule {}