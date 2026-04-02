export interface TokenPayload {
  sub: string;
  role: "admin" | "user";
  iat: number;
  exp: number;
}

export interface TokenPair {
  access: string;
  refresh: string;
}
