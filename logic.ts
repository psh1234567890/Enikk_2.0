export type BotCommand = { name: string; target: string };

export function parseCommand(input: string): BotCommand | null {
    const text = input.trim();
    if (!text.startsWith("!")) return null;
    const space = text.search(/\s/);
    if (space < 0) return { name: text, target: "" };
    return { name: text.slice(0, space), target: text.slice(space).trim() };
}

const tiers = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby"];

export function tierName(level: number): string {
    if (!Number.isInteger(level) || level < 1) return "Unrated";
    if (level >= 31) return "Master";
    const name = tiers[Math.floor((level - 1) / 5)] ?? "Unknown";
    return name + " " + (5 - ((level - 1) % 5));
}

export function tierScore(label: string | null | undefined): number {
    if (!label) return -1;
    const value = label.trim().toLowerCase();
    if (value === "master") return 31;
    if (value === "unrated") return 0;
    const match = /^(bronze|silver|gold|platinum|diamond|ruby)\s+([1-5])$/i.exec(label.trim());
    if (!match) return -1;
    const index = tiers.findIndex(x => x.toLowerCase() === match[1]?.toLowerCase());
    const rank = Number(match[2]);
    return index * 5 + (6 - rank);
}

export function recommendationRank(totalSolved: number): number {
    if (!Number.isSafeInteger(totalSolved) || totalSolved < 1) return -1;
    // 상위 해결 문제 중 최대 11번째 문제 기준. 통계적 중앙값은 아니다.
    return Math.min(totalSolved - 1, 10);
}

export function buildSearchUrl(query: string, page = 1, sort?: string): string {
    const params = new URLSearchParams({ query, page: String(page) });
    if (sort) {
        params.set("sort", sort);
        params.set("direction", "desc");
    }
    return "https://solved.ac/api/v3/search/problem?" + params.toString();
}

export function chooseRandom<T>(items: readonly T[], max = 5, random: () => number = Math.random): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, Math.max(0, max));
}

export function isSafeHandle(value: string): boolean {
    return /^[A-Za-z0-9_]{1,40}$/.test(value);
}
export function isAuthorizedSensitiveMessage(
    guildId: string | null,
    channelId: string,
    allowedGuildId: string,
    allowedChannelIds: ReadonlySet<string>
): boolean {
    return Boolean(allowedGuildId && guildId === allowedGuildId && allowedChannelIds.has(channelId));
}