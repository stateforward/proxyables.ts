import pino from "pino";
export const createLogger = ({ module }: { module: string }) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const isVitest = process.env.VITEST === "true";
  const envLevel = process.env.PROXYABLE_LOG_LEVEL;
  const level = envLevel ?? (isDevelopment || isVitest ? "debug" : "info");
  const parameters = {
    level,
    module,
  };
  return pino(parameters);
};

export const logger = createLogger({ module: "proxyable" });
