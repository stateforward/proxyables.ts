const workerpool = require("workerpool");

function ping() {
  return 1;
}

function sum(a, b) {
  return a + b;
}

function echoLength(input) {
  return input.length;
}

function withCallback(value) {
  return value;
}

workerpool.worker({
  ping,
  sum,
  echoLength,
  withCallback,
});
