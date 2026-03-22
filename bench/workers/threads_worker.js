const { expose } = require("threads/worker");

expose({
  ping() {
    return 1;
  },
  sum(a, b) {
    return a + b;
  },
  echoLength(input) {
    return input.length;
  },
  withCallback(value) {
    return value;
  },
});
