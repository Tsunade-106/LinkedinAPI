import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { AppError } from "../domain/errors.js";

export function buildApiKeyGuard(apiKeys: Config["apiKeys"]): (request: FastifyRequest) => Promise<void> {
  const accepted = apiKeys.map(hash);
  return (request) => {
    if (accepted.length === 0) return Promise.resolve();
    const candidate = request.headers["x-api-key"];
    if (typeof candidate !== "string") throw unauthorized();
    const candidateHash = hash(candidate);
    if (!accepted.some((expected) => timingSafeEqual(candidateHash, expected))) throw unauthorized();
    return Promise.resolve();
  };
}

export function fingerprintApiKey(value: string): string {
  return hash(value).toString("hex").slice(0, 16);
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "A valid X-API-Key header is required", 401);
}
