import { encode } from "@msgpack/msgpack";
import { ProxyInstructionEncoder } from "./types";

export const createEncoder = (): ProxyInstructionEncoder => {
  return {
    encode: (data: unknown) => {
      return encode(data);
    },
  };
};
