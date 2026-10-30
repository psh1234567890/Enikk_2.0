import { Client, GatewayIntentBits, EmbedBuilder, Events, type Message } from "discord.js";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import {
    buildSearchUrl, chooseRandom, isSafeHandle, isAuthorizedSensitiveMessage, parseCommand,
    recommendationRank, tierName, tierScore
} from "./logic.js";

dotenv.config();

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error("환경 변수 누락: " + name);
    return value;
}

const discordToken = requiredEnv("DISCORD_TOKEN");
const supabaseUrl = requiredEnv("SUPABASE_URL");
const supabaseKey = requiredEnv("SUPABASE_KEY");
const clubAccessKey = requiredEnv("O1_DB_ACCESS_KEY");

// 서버/채널을 지정하지 않으면 학생 개인정보 조회 명령은 모두 차단한다.
const allowedGuildId = process.env.O1_GUILD_ID?.trim() ?? "";
const allowedChannelIds = new Set(
    (process.env.O1_ALLOWED_CHANNEL_IDS ?? "").split(",").map(x => x.trim()).filter(Boolean)
);
const configuredAccess = Boolean(allowedGuildId && allowedChannelIds.size > 0);
if (!configuredAccess) {
    console.warn("[보안] O1_GUILD_ID / O1_ALLOWED_CHANNEL_IDS 미설정: 개인정보 조회 명령 비활성화");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { "x-o1-club-key": clubAccessKey } }
});
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    allowedMentions: { parse: [] }
});

const http = axios.create({
    timeout: 8500,
    headers: { "User-Agent": "O1_Club_Bot/2.0" }
});

type Student = {
    student_id: number;
    name: string | null;
    baekjoon_id: string | null;
    solved_ac_tier: string | null;
    jungol_id: string | null;
    jungol_tier: string | null;
};

type SolvedProblem = { problemId: number; titleKo: string; level: number };
type SearchResponse = { count: number; items: SolvedProblem[] };
type TierResponse = { tier: number };
type StatResponse = { level: number; solved: number }[];

const cppGuide: Record<string, { title: string; description: string; sample: string }> = {
    vector: {
        title: "std::vector",
        description: "크기가 동적으로 변하는 연속 메모리 배열. 끝에 추가하는 push_back은 분할상환 O(1)입니다.",
        sample: "#include <vector>\nstd::vector<int> v;\nv.push_back(10);\nif (!v.empty()) { int x = v[0]; }"
    },
    map: {
        title: "std::map",
        description: "키를 정렬해 관리하는 연관 컨테이너. 기본 구현은 균형 이진 탐색 트리로 주요 연산이 O(log N)입니다.",
        sample: "#include <map>\nstd::map<int, int> cnt;\ncnt[3]++;\nif (cnt.find(3) != cnt.end()) { /* found */ }"
    },
    dfs: {
        title: "DFS",
        description: "깊이 우선 탐색. 방문 여부를 기록하고 인접한 정점을 재귀 또는 스택으로 탐색합니다.",
        sample: "#include <vector>\nvoid dfs(int u, const std::vector<std::vector<int>>& g, std::vector<bool>& seen)\n{\n    seen[u] = true;\n    for (int v : g[u])\n    {\n        if (!seen[v]) dfs(v, g, seen);\n    }\n}"
    }
};

const cooldown = new Map<string, number>();
const cooldownMs = 5000;
const fence = String.fromCharCode(96).repeat(3);

function isAllowedChannel(message: Message): boolean {
    return configuredAccess
        && message.inGuild()
        && isAuthorizedSensitiveMessage(message.guildId, message.channelId, allowedGuildId, allowedChannelIds);
}

function display(value: string | null | undefined): string {
    return (value ?? "미등록").replace(/[@*~|]/g, "_").slice(0, 90);
}

function apiFailure(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 403) return "외부 사이트가 자동 조회를 차단했습니다.";
        if (status === 429) return "외부 사이트 요청 제한에 걸렸습니다. 잠시 후 다시 시도해 주세요.";
        if (error.code === "ECONNABORTED") return "외부 서비스 응답 시간이 초과됐습니다.";
        return "외부 사이트 연결에 실패했습니다.";
    }
    return "외부 데이터 해석 중 오류가 발생했습니다.";
}

async function findStudent(target: string): Promise<Student | null> {
    const numeric = /^\d{4,5}$/.test(target);
    if (!numeric && (target.length > 50 || !target)) {
        throw new Error("이름은 1~50자로 입력해 주세요.");
    }
    let query = supabase.from("students")
        .select("student_id,name,baekjoon_id,solved_ac_tier,jungol_id,jungol_tier");
    query = numeric ? query.eq("student_id", Number(target)) : query.eq("name", target);
    const { data, error } = await query.limit(2);
    if (error) {
        console.error("[DB] 조회 실패:", error.code);
        throw new Error("학생 DB 연결에 문제가 있습니다.");
    }
    if (!data || data.length === 0) return null;
    if (data.length > 1) throw new Error("같은 이름의 학생이 여러 명 있습니다. 학번으로 조회해 주세요.");
    return data[0] as Student;
}

async function listStudents(): Promise<Student[]> {
    const { data, error } = await supabase.from("students")
        .select("student_id,name,baekjoon_id,solved_ac_tier,jungol_id,jungol_tier")
        .order("student_id", { ascending: true }).limit(60);
    if (error) {
        console.error("[DB] 목록 조회 실패:", error.code);
        throw new Error("학생 목록을 불러올 수 없습니다.");
    }
    return (data ?? []) as Student[];
}

async function solvedTier(handle: string | null): Promise<string | null> {
    if (!handle || !isSafeHandle(handle)) return null;
    const response = await http.get<TierResponse>("https://solved.ac/api/v3/user/show", {
        params: { handle }
    });
    if (!Number.isInteger(response.data.tier)) throw new Error("solved.ac 티어 데이터 형식 오류");
    return tierName(response.data.tier);
}

async function jungolInfo(id: string | null): Promise<{ tier: string; rank: string; total: string } | null> {
    if (!id || !/^[A-Za-z0-9_]{1,40}$/.test(id) || id.toLowerCase() === "none") return null;
    const response = await http.get<string>("https://jungol.co.kr/account/" + encodeURIComponent(id));
    if (typeof response.data !== "string") return null;
    const html = response.data;
    const rawRank = /rank:(\d+)/.exec(html)?.[1];
    const rawTier = /tier:(\d+)/.exec(html)?.[1];
    const rawTotal = /<h2[^>]*>[\s\S]*?(\d+)\s*문제[\s\S]*?<\/h2>/.exec(html)?.[1]
        ?? /<!--\[-->(\d+)\s*문제<!--\]-->/.exec(html)?.[1];
    return {
        tier: rawTier ? tierName(Number(rawTier)) : "확인 불가",
        rank: rawRank ? rawRank + "위" : "확인 불가",
        total: rawTotal ?? "확인 불가"
    };
}

async function recommendation(handle: string | null): Promise<string> {
    if (!handle || !isSafeHandle(handle)) return "등록된 백준 ID가 없습니다.";
    const solvedQuery = "solved_by:" + handle;
    const response = await http.get<SearchResponse>(buildSearchUrl(solvedQuery, 1, "level"));
    const count = response.data?.count;
    if (!Number.isSafeInteger(count) || count < 0) return "문제 데이터 형식이 올바르지 않습니다.";
    if (count === 0) return "해결한 문제가 없어 아직 난도를 추정할 수 없습니다.";

    const rank = recommendationRank(count);
    const page = Math.floor(rank / 20) + 1;
    const idx = rank % 20;
    const pageResponse = page === 1 ? response : await http.get<SearchResponse>(buildSearchUrl(solvedQuery, page, "level"));
    const anchor = pageResponse.data?.items?.[idx];
    if (!anchor || !Number.isInteger(anchor.level)) return "추천 기준 난도를 산출할 수 없습니다.";

    for (const level of [anchor.level, Math.min(30, anchor.level + 1)]) {
        if (level < 1 || level > 30) continue;
        const query = "tier:" + level + " -solved_by:" + handle;
        const recResponse = await http.get<SearchResponse>(buildSearchUrl(query));
        const valid = (recResponse.data?.items ?? []).filter(
            p => Number.isInteger(p.problemId) && typeof p.titleKo === "string" && Number.isInteger(p.level)
        );
        if (valid.length > 0) {
            const chosen = chooseRandom(valid, 5);
            const lines = chosen.map(p => "[" + p.problemId + "] "
                + display(p.titleKo) + " (" + tierName(p.level) + ")"
                + " https://www.acmicpc.net/problem/" + p.problemId);
            return "**추천 기준: 상위 해결 문제의 " + tierName(level)
                + " 난도**\n(통계적 중앙값 아님)\n\n" + lines.join("\n");
        }
    }
    return "해당 난도에서 추천 가능한 미해결 문제를 찾지 못했습니다.";
}

async function solvedStats(handle: string | null): Promise<string> {
    if (!handle || !isSafeHandle(handle)) return "백준 ID 미등록";
    const response = await http.get<StatResponse>("https://solved.ac/api/v3/user/problem_stats", {
        params: { handle }
    });
    if (!Array.isArray(response.data)) throw new Error("solved.ac 통계 응답 형식 오류");
    const buckets = [0, 0, 0, 0, 0, 0];
    let total = 0;
    for (const stat of response.data) {
        if (!Number.isInteger(stat.level) || !Number.isInteger(stat.solved) || stat.solved < 0) continue;
        total += stat.solved;
        if (stat.level >= 1 && stat.level <= 30) {
            const index = Math.floor((stat.level - 1) / 5);
            buckets[index] = (buckets[index] ?? 0) + stat.solved;
        }
    }
    return "총 해결: " + total + "문제\nBronze " + buckets[0] + " · Silver " + buckets[1]
        + " · Gold " + buckets[2] + " · Platinum " + buckets[3]
        + " · Diamond " + buckets[4] + " · Ruby " + buckets[5];
}

async function replyHelp(message: Message): Promise<void> {
    await message.reply({
        embeds: [new EmbedBuilder().setColor(0x3b82f6).setTitle("O(1) 에닉 2.0 사용법")
            .setDescription("학생 조회 기능은 허가된 동아리 서버·채널에서만 이용 가능합니다.")
            .addFields(
                { name: "!조회 [이름/학번]", value: "백준·정올 프로필 및 티어 조회" },
                { name: "!문제추천 [이름/학번] 또는 !추천", value: "미해결 문제 최대 5개 추천" },
                { name: "!통계 [이름/학번]", value: "플랫폼별 풀이 통계" },
                { name: "!전체목록", value: "등록 부원 목록 (저장된 티어)" },
                { name: "!랭킹", value: "백준 티어 기반 동아리 랭킹 (저장된 값)" },
                { name: "!문법 [vector/map/dfs]", value: "간단한 C++ 문법 예시" }
            )]
    });
}

client.once(Events.ClientReady, () => {
    console.log("Enikk 2.0 로그인 성공");
    client.user?.setActivity("O(1) 알고리즘 학습");
});

client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    const cmd = parseCommand(message.content);
    if (!cmd) return;
    const recognized = new Set(["!사용법", "!문법", "!조회", "!문제추천", "!추천", "!통계", "!전체목록", "!랭킹"]);
    if (!recognized.has(cmd.name)) return;

    // 누구에게나 허용되는 공개 학습 도움말과 학생 데이터 명령을 분리한다.
    const sensitive = !["!사용법", "!문법"].includes(cmd.name);
    if (sensitive && !isAllowedChannel(message)) {
        await message.reply("이 명령은 지정된 O(1) 동아리 채널에서만 이용할 수 있습니다.");
        return;
    }

    const now = Date.now();
    const previous = cooldown.get(message.author.id) ?? 0;
    if (now - previous < cooldownMs) return;
    if (cooldown.size > 1000) cooldown.clear();
    cooldown.set(message.author.id, now);

    let pending: Message | null = null;
    try {
        if (cmd.name === "!사용법") {
            await replyHelp(message);
            return;
        }
        if (cmd.name === "!문법") {
            const key = cmd.target.toLowerCase();
            const guide = cppGuide[key];
            if (!guide) {
                await message.reply("지원하는 문법: vector, map, dfs");
                return;
            }
            const embed = new EmbedBuilder().setColor(0xeab308)
                .setTitle("C++ 가이드: " + guide.title)
                .setDescription(guide.description)
                .addFields({ name: "예제", value: fence + "cpp\n" + guide.sample + "\n" + fence });
            await message.reply({ embeds: [embed] });
            return;
        }

        if (cmd.name === "!전체목록" || cmd.name === "!랭킹") {
            pending = await message.reply("🔍 동아리 목록을 불러오는 중...");
            const students = await listStudents();
            if (students.length === 0) {
                await pending.edit("등록된 학생이 없습니다.");
                return;
            }
            if (cmd.name === "!랭킹") {
                students.sort((a, b) => tierScore(b.solved_ac_tier) - tierScore(a.solved_ac_tier));
            }
            const list = students.map((s, i) =>
                (i + 1) + ". " + display(s.name) + " — " + display(s.solved_ac_tier)
            );
            const embed = new EmbedBuilder().setColor(0x10b981)
                .setTitle(cmd.name === "!랭킹" ? "O(1) 동아리 백준 랭킹" : "O(1) 동아리 학생 목록")
                .setDescription(list.join("\n").slice(0, 3800))
                .setFooter({ text: "DB 저장 티어 기준 · 외부 API 실시간 순위가 아닙니다." });
            await pending.edit({ content: "조회 완료.", embeds: [embed] });
            return;
        }

        if (!cmd.target) {
            await message.reply("이름 또는 학번을 입력해 주세요. 예: !조회 1234");
            return;
        }

        pending = await message.reply("🔍 요청을 처리하고 있습니다...");
        const student = await findStudent(cmd.target);
        if (!student) {
            await pending.edit("등록된 학생을 찾을 수 없습니다.");
            return;
        }

        if (cmd.name === "!조회") {
            const [tierResult, jungolResult] = await Promise.allSettled([
                solvedTier(student.baekjoon_id),
                jungolInfo(student.jungol_id)
            ]);
            const tier = tierResult.status === "fulfilled" && tierResult.value
                ? tierResult.value : "실시간 확인 실패 (저장값: " + display(student.solved_ac_tier) + ")";
            const jungol = jungolResult.status === "fulfilled" ? jungolResult.value : null;
            const bjLink = student.baekjoon_id && isSafeHandle(student.baekjoon_id)
                ? "https://solved.ac/profile/" + encodeURIComponent(student.baekjoon_id) : "미등록";
            const jgLink = student.jungol_id && isSafeHandle(student.jungol_id)
                ? "https://jungol.co.kr/account/" + encodeURIComponent(student.jungol_id) : "미등록";
            const embed = new EmbedBuilder().setColor(0x3b82f6)
                .setTitle("O(1) 프로필: " + display(student.name))
                // 나이·성별·학번 등 불필요한 개인정보는 Discord에 표시하지 않는다.
                .addFields(
                    { name: "백준 (solved.ac)", value: tier + "\n" + bjLink },
                    { name: "정올 (JUNGOL)", value: (jungol ? jungol.tier + " · " + jungol.rank : "조회 불가/미등록") + "\n" + jgLink }
                )
                .setFooter({ text: "외부 API 오류는 저장된 DB 티어와 구분해 표시합니다." });
            await pending.edit({ content: "조회 완료.", embeds: [embed] });
            return;
        }

        if (cmd.name === "!문제추천" || cmd.name === "!추천") {
            let result: string;
            try {
                result = await recommendation(student.baekjoon_id);
            } catch (error) {
                result = apiFailure(error);
            }
            const embed = new EmbedBuilder().setColor(0xf59e0b)
                .setTitle(display(student.name) + " 맞춤 문제 추천")
                .setDescription(result.slice(0, 3900));
            await pending.edit({ content: "추천 결과", embeds: [embed] });
            return;
        }

        if (cmd.name === "!통계") {
            const [bj, jg] = await Promise.allSettled([
                solvedStats(student.baekjoon_id),
                jungolInfo(student.jungol_id)
            ]);
            const solved = bj.status === "fulfilled" ? bj.value : apiFailure(bj.reason);
            const jungol = jg.status === "fulfilled" && jg.value ? jg.value.total : "확인 불가";
            const embed = new EmbedBuilder().setColor(0xa855f7)
                .setTitle(display(student.name) + " 풀이 통계")
                .addFields(
                    { name: "백준", value: solved },
                    { name: "정올", value: "확인된 해결 문제: " + jungol }
                );
            await pending.edit({ content: "통계 조회 결과", embeds: [embed] });
        }
    } catch (error) {
        console.error("[Enikk] 명령 처리 실패:", error instanceof Error ? error.message : "Unknown error");
        const notice = error instanceof Error && (
            error.message.startsWith("이름은") || error.message.startsWith("같은 이름")
        ) ? error.message : "처리 중 문제가 발생했습니다. 관리자에게 확인해 주세요.";
        try {
            if (pending) await pending.edit(notice);
            else await message.reply(notice);
        } catch {
            console.error("[Enikk] Discord 오류 안내 전송 실패");
        }
    }
});

void client.login(discordToken).catch(error => {
    console.error("[Enikk] Discord 로그인 실패:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
});