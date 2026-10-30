import axios from "axios";
import { tierName } from "./logic.js";

const API_BASE = "https://jungol.co.kr";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const OK_TTL_MS = 5 * 60_000;
const ERROR_TTL_MS = 30_000;
const http = axios.create({
    timeout: 10_000,
    maxContentLength: MAX_JSON_BYTES,
    maxBodyLength: MAX_JSON_BYTES,
    headers: { "User-Agent": "O1_Club_Bot/2.1 (Jungol public profile)" },
    responseType: "json",
    validateStatus: (status: number) => status >= 200 && status < 300,
    maxRedirects: 2
});

type JSONObject = Record<string, unknown>;
export type JungolStatus = "ok" | "partial" | "unavailable";
export type JungolProfile = {
    status: JungolStatus;
    accountId: number | null;
    tier: string | null;
    rank: number | null;
    solvedCount: number | null;
    error: string | null;
};

const cache = new Map<string, { expires: number; data: JungolProfile }>();

function isObject(value: unknown): value is JSONObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value : null;
}

/**
 * SvelteKit's devalue payload stores references to array positions.
 * This intentionally supports only the plain object/list/scalar subset needed for
 * public Jungol account data. Unknown/invalid references become null.
 */
export function unflattenDevalue(flat: unknown): unknown {
    if (!Array.isArray(flat) || flat.length === 0 || flat.length > 150_000) return null;
    const values: unknown[] = flat;
    const visited = new Map<number, unknown>();

    function resolve(ref: unknown, depth = 0): unknown {
        if (typeof ref !== "number" || !Number.isInteger(ref)
            || ref < 0 || ref >= values.length || depth > 100) return null;
        if (visited.has(ref)) return visited.get(ref);
        const item: unknown = values[ref];
        if (Array.isArray(item)) {
            if (typeof item[0] === "string") {
                // Date/BigInt/Set and other tagged values aren't used here.
                return item.length > 1 ? item[1] : null;
            }
            const list: unknown[] = [];
            visited.set(ref, list);
            for (const next of item) list.push(resolve(next, depth + 1));
            return list;
        }
        if (isObject(item)) {
            const obj: JSONObject = {};
            visited.set(ref, obj);
            for (const [key, value] of Object.entries(item)) {
                if (key === "__proto__" || key === "constructor") continue;
                obj[key] = resolve(value, depth + 1);
            }
            return obj;
        }
        visited.set(ref, item);
        return item;
    }
    return resolve(0);
}

export function decodeSvelteNodes(payload: unknown): JSONObject {
    if (!isObject(payload) || !Array.isArray(payload.nodes)) return {};
    const decoded: JSONObject = {};
    for (const node of payload.nodes) {
        if (!isObject(node) || node.type !== "data") continue;
        const data = unflattenDevalue(node.data);
        if (!isObject(data)) continue;
        for (const [key, value] of Object.entries(data)) {
            if (key !== "__proto__" && key !== "constructor") decoded[key] = value;
        }
    }
    return decoded;
}

export function parseJungolAccount(payload: unknown): JungolProfile {
    const decoded = decodeSvelteNodes(payload);
    let profile: JSONObject | null = null;
    let stat: JSONObject | null = null;
    for (const [key, value] of Object.entries(decoded)) {
        if (!key.startsWith("$/account/") || !isObject(value) || !isObject(value.data)) continue;
        const inner = value.data;
        if (key.endsWith("/stat")) {
            stat = inner;
        } else if (typeof inner.handle === "string") {
            profile = inner;
        }
    }
    if (!profile) {
        return { status: "unavailable", accountId: null, tier: null, rank: null,
            solvedCount: null, error: "프로필 응답 구조가 변경되었거나 공개되지 않았습니다." };
    }

    const rawTier = nonnegativeInteger(profile.tier);
    const id = nonnegativeInteger(profile.id);
    const rank = nonnegativeInteger(profile.rank);
    // Current Jungol profiles expose solvedCount directly. Older payloads can
    // use a solved-history list; never mistake a missing count for zero.
    const directCount = nonnegativeInteger(profile.solvedCount);
    const solved = stat?.solved;
    const historyCount = Array.isArray(solved) ? solved.length : null;
    const count = directCount ?? historyCount;
    const verified = count !== null;
    return {
        status: verified ? "ok" : "partial",
        accountId: id,
        tier: rawTier !== null && rawTier <= 30
            ? tierName(rawTier)
            : count === 0 ? "Unrated" : null,
        rank: rank && rank > 0 ? rank : null,
        solvedCount: count,
        error: verified ? null : "풀이 기록을 확인할 수 없습니다."
    };
}

export function resolveJungolAccountId(payload: unknown): number | null {
    if (!isObject(payload) || payload.type !== "redirect"
        || typeof payload.location !== "string") return null;
    const matched = /(?:^|\/)account\/(\d+)\/?$/.exec(payload.location);
    if (!matched) return null;
    const id = Number(matched[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function normalizeJungolIdentifier(id: string | null): string | null {
    if (!id) return null;
    const value = id.trim().replace(/^@/, "");
    if (!value || value.toLowerCase() === "none") return null;
    return /^[A-Za-z0-9_-]{1,50}$/.test(value) ? value : null;
}

function unavailable(message: string): JungolProfile {
    return { status: "unavailable", accountId: null, rank: null,
        tier: null, solvedCount: null, error: message };
}

export async function fetchJungolProfile(input: string | null): Promise<JungolProfile> {
    const id = normalizeJungolIdentifier(input);
    if (!id) return unavailable("정올 계정이 등록되지 않았거나 ID 형식이 올바르지 않습니다.");

    const cached = cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;

    try {
        let accountId = /^\d+$/.test(id) ? Number(id) : null;
        if (accountId === null) {
            const lookup = await http.get<unknown>(
                API_BASE + "/@" + encodeURIComponent(id) + "/__data.json"
            );
            accountId = resolveJungolAccountId(lookup.data);
        }
        if (!accountId || !Number.isSafeInteger(accountId)) {
            return unavailable("정올 계정을 찾지 못했습니다.");
        }
        const response = await http.get<unknown>(
            API_BASE + "/account/" + accountId + "/__data.json"
        );
        const profile = parseJungolAccount(response.data);
        cache.set(id, { data: profile, expires: Date.now()
            + (profile.status === "ok" ? OK_TTL_MS : ERROR_TTL_MS) });
        return profile;
    } catch (error) {
        let message = "정올 연결에 실패했습니다.";
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            if (status === 403) message = "정올 서버에서 자동 조회를 제한했습니다.";
            else if (status === 404) message = "정올 프로필을 찾을 수 없습니다.";
            else if (status === 429) message = "정올 요청 제한 중입니다. 잠시 후 다시 시도해 주세요.";
            else if (error.code === "ECONNABORTED") message = "정올 응답이 지연되고 있습니다.";
        }
        const result = unavailable(message);
        cache.set(id, { data: result, expires: Date.now() + ERROR_TTL_MS });
        return result;
    }
}