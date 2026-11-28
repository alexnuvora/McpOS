import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";

const script = readFileSync(new URL("../desktop/src-tauri/src/browser/snapshot.js", import.meta.url), "utf8");
const button = () => ({
  localName: "button", tagName: "BUTTON", innerText: "Continue",
  getClientRects: () => [1], closest: () => null, matches: () => false, getAttribute: () => null,
});

test("identical controls in different frames have distinct snapshot-bound references", () => {
  const main = button(), child = button();
  const frame = { ...button(), localName: "iframe", contentDocument: { querySelectorAll: () => [child] } };
  const context = {
    document: { title: "Test", querySelectorAll: () => [main, frame, { ...frame, contentDocument: null }] },
    location: { origin: "https://example.com", pathname: "/" }, crypto: { randomUUID }, window: {},
  };
  const first = runInNewContext(script, context);
  const [one, two] = first.interactive;
  assert.notEqual(one.elementId, two.elementId);
  assert.equal(context.window.__mcposSnapshot.targets.get(two.elementId), child);
  const next = runInNewContext(script, context);
  assert.notEqual(next.snapshotId, first.snapshotId);
  assert.equal(context.window.__mcposSnapshot.targets.has(one.elementId), false);
});
