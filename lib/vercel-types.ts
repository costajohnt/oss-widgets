import type { IncomingMessage, ServerResponse } from 'http';

/** Minimal Vercel request/response types (avoids heavy @vercel/node devDependency). */
export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
}
export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  send(body: string): VercelResponse;
}
