import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GuestLoginDto } from './dto/guest-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Creates a signed guest JWT for the provided display name. The
   * returned token can be used to authenticate subsequent REST and
   * WebSocket requests. In a typical Scrum Poker flow this endpoint
   * would be called from the nickname entry screen.
   */
  @Post('guest')
  async guest(@Body() body: { displayName: string }) {
      const { displayName } = body;
      return this.authService.issueGuestToken(displayName);
  }
}