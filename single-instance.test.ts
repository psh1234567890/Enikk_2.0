import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock, DuplicateInstanceError } from "./single-instance.js";

test("Only one Enikk process may own the project lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "enikk-lock-test-"));
    const path = join(dir, ".enikk2.pid");
    let release: (() => void) | undefined;
    try {
        release = acquireInstanceLock(path);
        assert.equal(Number(readFileSync(path, "utf8").trim()), process.pid);
        assert.throws(() => acquireInstanceLock(path), DuplicateInstanceError);
        release();
        release = undefined;
        const releaseAgain = acquireInstanceLock(path);
        releaseAgain();
    } finally {
        release?.();
        rmSync(dir, { recursive: true, force: true });
    }
});