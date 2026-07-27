import assert from "node:assert/strict";
import test from "node:test";
import { lockedServiceHelp, projectUnlockCommand } from "../src/project-context.js";

test("unlock command pins the current project directory", () => {
  assert.equal(
    projectUnlockCommand("/Users/example/agent pay"),
    "cd '/Users/example/agent pay'\nnpx -y github:zwowo1997/gcp-x402 unlock",
  );
});

test("unlock command safely quotes apostrophes", () => {
  assert.match(projectUnlockCommand("/tmp/alice's bot"), /alice'"'"'s bot/);
});

test("locked help explains why the directory matters", () => {
  assert.match(lockedServiceHelp("/work/strategy"), /session missing for this project directory/i);
  assert.match(lockedServiceHelp("/work/strategy"), /cd '\/work\/strategy'/);
});
