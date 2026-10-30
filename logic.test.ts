import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, chooseRandom, isSafeHandle, isAuthorizedSensitiveMessage, parseCommand, recommendationRank, tierName, tierScore } from "./logic.js";

test("command parser preserves names and rejects normal chatter", () => {
    assert.deepEqual(parseCommand(" !조회 홍 길동 "), { name: "!조회", target: "홍 길동" });
    assert.deepEqual(parseCommand("!랭킹"), { name: "!랭킹", target: "" });
    assert.equal(parseCommand("일반 채팅"), null);
});

test("solved.ac tier mapping and ranking", () => {
    assert.equal(tierName(1), "Bronze 5");
    assert.equal(tierName(11), "Gold 5");
    assert.equal(tierName(31), "Master");
    assert.equal(tierScore("Gold 5"), 11);
    assert.equal(tierScore("Master"), 31);
    assert.equal(tierScore("Unknown"), -1);
});

test("recommendation difficulty anchor is top 11th, not median", () => {
    assert.equal(recommendationRank(0), -1);
    assert.equal(recommendationRank(1), 0);
    assert.equal(recommendationRank(8), 7);
    assert.equal(recommendationRank(200), 10);
});

test("external query is URL-encoded", () => {
    const url = new URL(buildSearchUrl("tier:11 -solved_by:a&b", 2, "level"));
    assert.equal(url.searchParams.get("query"), "tier:11 -solved_by:a&b");
    assert.equal(url.searchParams.get("direction"), "desc");
    assert.equal(url.searchParams.get("page"), "2");
});

test("random recommendations do not mutate input", () => {
    const src = [1, 2, 3, 4, 5, 6];
    const items = chooseRandom(src, 5, () => 0.25);
    assert.equal(items.length, 5);
    assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
    assert.equal(new Set(items).size, 5);
});

test("profile handles do not permit path injection", () => {
    assert.equal(isSafeHandle("sample_user123"), true);
    assert.equal(isSafeHandle("../evil"), false);
    assert.equal(isSafeHandle("a&b"), false);
});
test("sensitive command authorization fails closed", () => {
    const channels = new Set(["private-room"]);
    assert.equal(isAuthorizedSensitiveMessage("club", "private-room", "club", channels), true);
    assert.equal(isAuthorizedSensitiveMessage("other", "private-room", "club", channels), false);
    assert.equal(isAuthorizedSensitiveMessage("club", "public-room", "club", channels), false);
    assert.equal(isAuthorizedSensitiveMessage(null, "private-room", "club", channels), false);
    assert.equal(isAuthorizedSensitiveMessage("club", "private-room", "", channels), false);
});