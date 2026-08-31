import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "Graceful shutdown started");
  const forceExit = setTimeout(() => process.exit(1), config.scrapeTimeoutMs + 5_000).unref();
  await app.close();
  clearTimeout(forceExit);
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "Server failed to start");
  process.exit(1);
}
