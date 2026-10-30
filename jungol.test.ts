import test from "node:test";
import assert from "node:assert/strict";
import {
    decodeSvelteNodes, fetchJungolProfile, normalizeJungolIdentifier,
    parseJungolAccount, resolveJungolAccountId, unflattenDevalue
} from "./jungol.js";

function buildProfile(tier: number | null, solvedCount: number | null): unknown {
    const fields: Record<string, number> = { handle: 3, id: 4 };
    const flat: unknown[] = [
        { "$/account/42": 1 },
        { data: 2 },
        fields,
        "sample",
        42
    ];
    if (tier !== null) {
        fields.tier = flat.length;
        flat.push(tier);
    }
    if (solvedCount !== null) {
        fields.solvedCount = flat.length;
        flat.push(solvedCount);
    }
    return { nodes: [{ type: "data", data: flat }] };
}

test("Jungol SvelteKit devalue decoder returns a valid profile", () => {
    const data = buildProfile(11, 42);
    const output = parseJungolAccount(data);
    assert.equal(output.status, "ok");
    assert.equal(output.accountId, 42);
    assert.equal(output.tier, "Gold 5");
    assert.equal(output.solvedCount, 42);
    assert.equal(output.rank, null);
});

test("Jungol 0 solved is real zero, not an error", () => {
    const data = parseJungolAccount(buildProfile(null, 0));
    assert.equal(data.status, "ok");
    assert.equal(data.solvedCount, 0);
    assert.equal(data.tier, "Unrated");
});

test("Jungol missing solved count does not pretend zero", () => {
    const data = parseJungolAccount(buildProfile(11, null));
    assert.equal(data.status, "partial");
    assert.equal(data.tier, "Gold 5");
    assert.equal(data.solvedCount, null);
});

test("Jungol unrecognized response cannot create fabricated stats", () => {
    const data = parseJungolAccount({ nodes: [] });
    assert.equal(data.status, "unavailable");
    assert.equal(data.accountId, null);
    assert.equal(data.solvedCount, null);
});

test("Jungol handle redirect parsing and identifier validation", () => {
    assert.equal(resolveJungolAccountId({ type: "redirect", location: "./account/42058" }), 42058);
    assert.equal(resolveJungolAccountId({ type: "redirect", location: "./" }), null);
    assert.equal(resolveJungolAccountId({ type: "data", location: "./account/42058" }), null);
    assert.equal(normalizeJungolIdentifier("@valid_user"), "valid_user");
    assert.equal(normalizeJungolIdentifier("None"), null);
    assert.equal(normalizeJungolIdentifier("../private"), null);
});

test("Jungol devalue ignores invalid references and absent nodes", () => {
    assert.deepEqual(unflattenDevalue([{ x: -1, y: 500 }]), { x: null, y: null });
    assert.deepEqual(decodeSvelteNodes({ nodes: [{ type: "skip" }] }), {});
});

test("Jungol missing ID yields unavailable without a network request", async () => {
    const result = await fetchJungolProfile("None");
    assert.equal(result.status, "unavailable");
    assert.equal(result.solvedCount, null);
});