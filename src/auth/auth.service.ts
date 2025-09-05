import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/**
 * The AuthService encapsulates logic related to creating and
 * verifying JSON Web Tokens used for authentication. For this
 * application we support a guest login mode where a display name is
 * supplied and a signed token is issued. In a production system
 * persistent user accounts could be added here.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generates a guest token for the supplied display name. The
   * subject of the token is a random UUID. The token expires in
   * several hours (configurable via JWT_EXPIRATION). Additional
   * claims can be added here if needed.
   */
  async generateGuestToken(displayName: string): Promise<string> {
    const subject = randomUUID();
    const payload = { sub: subject, displayName };
    const secret = this.configService.get<string>('JWT_SECRET') || 'changeMe';
    const expiresIn = this.configService.get<string>('JWT_EXPIRATION') || '12h';
    return this.jwtService.sign(payload, { secret, expiresIn });
  }

  /**
   * Validates a JWT payload. In this example we simply accept the
   * payload as is. In a real application you could perform
   * additional checks (e.g. user exists, not banned, etc.).
   */
  async validateJwtPayload(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException();
    }
    return payload;
  }

    async issueGuestToken(displayName: string) {
        // Kalıcı kullanıcı veritabanı yoksa misafir için random userId üret
        const userId = randomUUID();

        const payload = {
            sub: userId,        // <-- standart claim
            userId,             // <-- bizim gateway de bunu okuyor
            displayName,
            role: 'guest',
        };

        const accessToken = await this.jwtService.signAsync(payload, {
            secret: this.configService.get<string>('JWT_SECRET'),
            expiresIn: this.configService.get<string>('JWT_EXPIRATION') ?? '12h',
        });

        return { accessToken, userId, displayName };
    }
}



