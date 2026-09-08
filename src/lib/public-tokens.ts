import { SignJWT,jwtVerify } from "jose";
function secret(){const value=process.env.PUBLIC_TOKEN_SECRET;if(!value||value.length<32)throw new Error("PUBLIC_TOKEN_SECRET must be at least 32 characters");return new TextEncoder().encode(value)}
export async function signPublicToken(payload:Record<string,string>,expires="30d"){return new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime(expires).sign(secret())}
export async function verifyPublicToken(token:string){const {payload}=await jwtVerify(token,secret());return payload}
