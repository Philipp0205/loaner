import assert from "node:assert/strict";
import test from "node:test";

// public/util.js is plain JS with no DOM use at import time, so node can load it directly.
const { fmtAmount, fmtAmountPlain } = (await import(new URL("../public/util.js", import.meta.url).href)) as {
  fmtAmount: (amount: number) => string;
  fmtAmountPlain: (amount: number) => string;
};

test("fmtAmount: euros, no decimals when whole, two decimals otherwise", () => {
  assert.equal(fmtAmount(5), "€5");
  assert.equal(fmtAmount(12.5), "€12.50");
  assert.equal(fmtAmount(0.5), "€0.50");
  assert.equal(fmtAmount(1234.5), "€1,234.50");
  assert.equal(fmtAmount(10_000), "€10,000");
});

test("fmtAmountPlain: the number for the item form, without a currency sign", () => {
  assert.equal(fmtAmountPlain(5), "5");
  assert.equal(fmtAmountPlain(12.5), "12.50");
});
