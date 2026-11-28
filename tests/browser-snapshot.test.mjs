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

test("modal editor is not crowded out by background buttons", () => {
  const background = Array.from({length: 150}, button);
  const editor = {...button(), localName:"div", tagName:"DIV", innerText:"", matches: s => s.includes("contenteditable"), getAttribute: k => k === "role" ? "textbox" : null};
  const modal = {...button(), querySelectorAll: () => [editor]};
  const document = {title:"Modal test",querySelectorAll: s => s.startsWith('[role="dialog"]') ? [modal] : [...background,editor]};
  const result = runInNewContext(script,{document,location:{origin:"https://example.com",pathname:"/"},crypto:{randomUUID},window:{}});
  assert.equal(result.interactive.length,1);
  assert.equal(result.interactive[0].editable,true);
});

test("rich editor exposes its accessible label and frame-local bounds", () => {
  const doc = {title:"Composer", getElementById: () => ({textContent:"Write a post"})};
  const editor = {...button(), innerText:"", tagName:"DIV", localName:"div", ownerDocument:doc, isContentEditable:true,
    getAttribute:k=>({"aria-labelledby":"title","role":"textbox","aria-multiline":"true"})[k],
    getBoundingClientRect:()=>({x:15,y:30,width:280,height:92})};
  doc.querySelectorAll=s=>s.startsWith('[role="dialog"]')?[]:[editor];
  const {interactive:[item]}=runInNewContext(script,{document:doc,window:{},location:{origin:"https://example.com",pathname:"/"},crypto:{randomUUID}});
  assert.equal(item.editable,true);
  assert.equal(item.richText,true);
  assert.equal(item.label,"Write a post");
  assert.deepEqual({...item.bounds},{x:15,y:30,width:280,height:92,coordinateSpace:"frame viewport"});
});

test("nested close-only dialog does not hide the enclosing rich editor", () => {
  const editor = {...button(), localName:"div", tagName:"DIV", innerText:"", isContentEditable:true, matches:s=>s.includes("contenteditable"), getAttribute:k=>k==="aria-placeholder"?"Write a post":k==="role"?"textbox":null};
  const close = {...button(), innerText:"Close"};
  const nested = {...button(), querySelectorAll:()=>[close]};
  const outer = {...button(), querySelectorAll:s=>s.startsWith("textarea,")?[editor]:[editor,close]};
  nested.querySelectorAll = s=>s.startsWith("textarea,")?[]:[close];
  const document = {title:"Nested modal", querySelectorAll:s=>s.startsWith('[role="dialog"]')?[outer,nested]:[editor,close]};
  const result = runInNewContext(script,{document,location:{origin:"https://example.com",pathname:"/"},crypto:{randomUUID},window:{}});
  assert.equal(result.interactive[0].label,"Write a post");
  assert.equal(result.interactive[0].editable,true);
  assert.equal(result.interactive.length,2);
});
