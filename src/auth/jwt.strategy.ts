import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

/**
 * Passport strategy for validating JSON Web Tokens. It extracts
 * tokens from the Authorization header as a Bearer token and
 * delegates validation to AuthService. The payload is attached to
 * the request as `req.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService, private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'changeMe',
    });
  }

  async validate(payload: any) {
    return this.authService.validateJwtPayload(payload);
  }
}