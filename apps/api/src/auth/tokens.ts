import { SignJWT, jwtVerify } from 'jose';

export interface TokenClaims {
  sub: string; // user id
  mid: string | null; // active membership id (club context)
}

export class TokenService {
  private key: Uint8Array;
  constructor(
    secret: string,
    private ttl: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(claims: TokenClaims): Promise<string> {
    return new SignJWT({ mid: claims.mid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(this.ttl)
      .sign(this.key);
  }

  async verify(token: string): Promise<TokenClaims> {
    const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
    return { sub: String(payload.sub), mid: (payload.mid as string | null) ?? null };
  }
}
