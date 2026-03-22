import pino from "pino";
import pretty from "pino-pretty";
import caller from "pino-caller";
export const createLogger = ({ module }: { module: string }) => {
  const isDevelopment = process.env.NODE_ENV === "development";
  const isVitest = process.env.VITEST === "true";
  const envLevel = process.env.PROXYABLE_LOG_LEVEL;
  const level = envLevel ?? (isDevelopment || isVitest ? "debug" : "info");
  const stream =
    isDevelopment || isVitest
      ? pretty({
          colorize: true,
        })
      : undefined;
  const parameters = {
    level,
    module,
  };
  return isDevelopment || isVitest
    ? caller(pino(parameters, stream))
    : pino(parameters, stream);
};

export const logger = createLogger({ module: "proxyable" });
