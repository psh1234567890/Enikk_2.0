console.log('--- 에닉(Enik) 2.0 가동 준비 ---');

import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import https from 'https'; // ✨ 범인 1 해결: 최신 문법으로 https 모듈 소환!

dotenv.config();

// ✨ 범인 2 해결: 솔브닥 방화벽을 뚫기 위한 전역 명찰(User-Agent) 부착! ✨
// 이렇게 해두면 앞으로 axios가 쏘는 모든 요청에 당당하게 에닉의 이름표가 붙습니다.
axios.defaults.headers.common['User-Agent'] = 'O(1)_Club_Bot/2.0 (Contact: SeungHoon)';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "여기에_디스코드_봇_토큰_입력";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://yxukggorpqsrwurbamxv.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "여기에_Supabase_Anon_Key_입력";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// --- [유틸리티 함수] ---

function convertTier(level: number): string 
{
    if (level <= 0) return "Unrated";
    const colors = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ruby", "Master"];
    const colorIdx = Math.floor((level - 1) / 5);
    const rank = 5 - ((level - 1) % 5);
    if (colorIdx > 5) return "Master";
    return `${colors[colorIdx]} ${rank}`;
}

function shuffleArray(array: any[]) 
{
    for (let i = array.length - 1; i > 0; i--) 
    {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 1. 정올 크롤링 (프로필 정보)
async function scrapeJungolProfile(userId: string) 
{
    if (!userId || userId === 'None') return null;
    try 
    {
        const url = `https://jungol.co.kr/account/${userId}`;
        // require 대신 import한 https를 사용!
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const response = await axios.get(url, { httpsAgent });
        const html = response.data;

        const rankMatch = html.match(/rank:(\d+)/);
        const tierMatch = html.match(/tier:(\d+)/);

        if (rankMatch && tierMatch) 
        {
            const rank = parseInt(rankMatch[1], 10);
            const tierVal = parseInt(tierMatch[1], 10);
            return {
                rankStr: `${rank}위`,
                tierStr: convertTier(tierVal)
            };
        }
        return null;
    } 
    catch (error: any) 
    {
        console.error(`[에러] 정올 크롤링 실패 (${userId}):`, error.message);
        return null;
    }
}

// 2. 백준 티어 API
async function getSolvedAcTier(handle: string) 
{
    if (!handle || handle === 'None') return "미연동";
    try 
    {
        const url = `https://solved.ac/api/v3/user/show?handle=${handle}`;
        const response = await axios.get(url);
        return convertTier(response.data.tier);
    } 
    catch (error: any) 
    {
        console.error(`[에러] 백준 티어 조회 실패 (${handle}):`, error.message);
        return "미연동 또는 오류";
    }
}

// 3. 백준 맞춤 문제 추천 엔진
async function getRecommendedProblems(handle: string) 
{
    if (!handle || handle === 'None') return "백준 아이디가 등록되지 않았습니다.";
    
    try 
    {
        const url = `https://solved.ac/api/v3/search/problem?query=solved_by%3A${handle}&sort=level&direction=desc`;
        const res = await axios.get(url);
        const totalSolved = res.data.count;

        if (totalSolved === 0) return "푼 문제가 없어 추천이 불가능합니다.";

        const targetRank = Math.min(totalSolved - 1, 10);
        const page = Math.floor(targetRank / 20) + 1;
        let itemIdx = targetRank % 20;

        const pagedUrl = `${url}&page=${page}`;
        const pagedRes = await axios.get(pagedUrl);
        let items = pagedRes.data.items;

        if (items.length <= itemIdx) itemIdx = items.length - 1;
        let medianLevel = items[itemIdx].level;

        let recUrl = `https://solved.ac/api/v3/search/problem?query=tier%3A${medianLevel}%20-solved_by%3A${handle}`;
        let recRes = await axios.get(recUrl);
        let recItems = recRes.data.items;

        if (recItems.length === 0) 
        {
            medianLevel++;
            recUrl = `https://solved.ac/api/v3/search/problem?query=tier%3A${medianLevel}%20-solved_by%3A${handle}`;
            recRes = await axios.get(recUrl);
            recItems = recRes.data.items;
        }

        if (recItems.length === 0) return "추천할 만한 문제를 찾지 못했습니다.";

        shuffleArray(recItems);
        const selected = recItems.slice(0, 5);

        let result = `**주력 구간: ${convertTier(medianLevel)}**\n\n`;
        for (const prob of selected) 
        {
            result += `[${prob.problemId}] ${prob.titleKo} (${convertTier(prob.level)})\n`;
        }
        return result;
    } 
    catch (error: any) 
    {
        console.error("[추천 에러]", error.message);
        return "문제 분석 중 오류가 발생했습니다. (방화벽 차단 등)";
    }
}

// 4. 백준 티어별 푼 문제 통계 API
async function getSolvedAcStats(handle: string) 
{
    if (!handle || handle === 'None') return null;
    try 
    {
        const res = await axios.get(`https://solved.ac/api/v3/user/problem_stats?handle=${handle}`);
        let total = 0;
        let counts = { Bronze: 0, Silver: 0, Gold: 0, Platinum: 0, Diamond: 0, Ruby: 0 };

        for (const stat of res.data) 
        {
            total += stat.solved;
            if (stat.level >= 1 && stat.level <= 5) counts.Bronze += stat.solved;
            else if (stat.level >= 6 && stat.level <= 10) counts.Silver += stat.solved;
            else if (stat.level >= 11 && stat.level <= 15) counts.Gold += stat.solved;
            else if (stat.level >= 16 && stat.level <= 20) counts.Platinum += stat.solved;
            else if (stat.level >= 21 && stat.level <= 25) counts.Diamond += stat.solved;
            else if (stat.level >= 26 && stat.level <= 30) counts.Ruby += stat.solved;
        }
        return { total, counts };
    } 
    catch (error: any) 
    {
        console.error(`[에러] 백준 통계 조회 실패 (${handle}):`, error.message);
        return null; 
    }
}

// 6. ✨ 최종 완성본: 정올 푼 문제 통계 파싱 ✨
async function getJungolStats(userId: string) 
{
    if (!userId || userId === 'None') return null;
    try 
    {
        const url = `https://jungol.co.kr/account/${userId}`;
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const response = await axios.get(url, { httpsAgent });
        const html = response.data;

        // 대장님이 찾아낸 단서 1번의 완벽한 패턴 적용!
        // <h2 class="..."> 안쪽에 숨겨진 "OO문제" 또는 <!--[-->OO문제<!--]--> 를 정확히 타격합니다.
        const totalMatch = html.match(/<h2[^>]*>.*?(\d+)문제.*?<\/h2>/) 
                        || html.match(/<!--\[-->(\d+)문제<!--\]-->/);
        
        let total = "확인 불가";
        if (totalMatch) 
        {
            total = totalMatch[1];
        }
        
        return { total };
    } 
    catch (error: any) 
    {
        console.error(`[에러] 정올 통계 조회 실패 (${userId}):`, error.message);
        return null;
    }
}

// 5. C++ 문법/STL 가이드 데이터
const cppGuide: Record<string, { title: string, desc: string, code: string }> = {
    "vector": {
        title: "std::vector (동적 배열)",
        desc: "크기가 자유자재로 늘어나는 배열이야. 메모리를 연속적으로 써서 캐시 효율이 엄청 좋아.",
        code: "vector<int> v;\nv.push_back(10);\n\nif (v.size() > 0 and v[0] == 10)\n{\n    cout << \"O(1)\";\n}"
    },
    "map": {
        title: "std::map (딕셔너리)",
        desc: "Key-Value 쌍으로 데이터를 저장해. 탐색 속도가 빠르고 데이터를 찾을 때 유용해.",
        code: "map<string, int> m;\nm[\"승훈\"] = 1;\n\nif (m.find(\"승훈\") != m.end() or m.size() > 0)\n{\n    cout << \"Found!\";\n}"
    },
    "dfs": {
        title: "DFS (깊이 우선 탐색)",
        desc: "재귀함수나 스택을 써서 그래프의 끝까지 파고드는 탐색법이야.",
        code: "bool visited[100];\n\nvoid dfs(int node)\n{\n    visited[node] = true;\n    \n    if (node == 100 or visited[node] == false)\n    {\n        return;\n    }\n}"
    }
};

// --- [디스코드 봇 이벤트] ---

client.once('clientReady', () => {
    console.log(`🤖 에닉 2.0 온라인! 로그인 완료: ${client.user?.tag}`);
    client.user?.setActivity('시스템 관리 가동 중...', { type: 3 });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!사용법') 
    {
        const helpEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('[에닉 2.0 명령어 사용법]')
            .addFields(
                { name: '`!조회 [이름/학번]`', value: '부원의 백준/정올 실시간 티어와 정보를 조회합니다.' },
                { name: '`!문제추천 [이름/학번]`', value: '맞춤 문제를 5개 추천합니다. (API 차단 시 오류 발생 가능)' },
                { name: '`!통계 [이름/학번]`', value: '백준 티어별 해결 개수 및 정올 통계를 분석합니다.' },
                { name: '`!문법 [키워드]`', value: 'C++ 핵심 문법 가이드 제공 (예: `vector`, `map`, `dfs`)' }
            );
        
        message.reply({ embeds: [helpEmbed] });
        return;
    }

    const args = message.content.split(' ');
    const cmd = args[0];

    if (cmd === '!문법') 
    {
        if (args.length < 2) 
        {
            message.reply("검색할 키워드를 입력해 주십시오. (현재 지원: `vector`, `map`, `dfs`)");
            return;
        }
        const keyword = args[1].toLowerCase();
        if (cppGuide[keyword]) 
        {
            const guideEmbed = new EmbedBuilder()
                .setColor('#ffcc00')
                .setTitle(`📘 O(1) C++ 가이드: ${cppGuide[keyword].title}`)
                .setDescription(cppGuide[keyword].desc)
                .addFields({ name: '💻 코드 예시', value: `\`\`\`cpp\n${cppGuide[keyword].code}\n\`\`\`` });
            message.reply({ embeds: [guideEmbed] });
        } 
        else 
        {
            message.reply("등록되지 않은 문법입니다.");
        }
        return;
    }

    const isLookup = cmd === '!조회';
    const isRecommend = cmd === '!문제추천';
    const isStat = cmd === '!통계';

    if (!isLookup && !isRecommend && !isStat) return;

    if (args.length < 2) 
    {
        message.reply(`명령어가 잘못되었습니다. (예: \`${cmd} 승훈\` 또는 \`${cmd} 1234\`)`);
        return;
    }
    const targetQuery = args[1];

    try 
    {
        const waitMsg = await message.reply(`🔍 DB에서 **${targetQuery}** 데이터를 불러오는 중...`);

        const isNumeric = /^\d+$/.test(targetQuery);
        let dbQuery = supabase.from('students').select('*');
        
        if (isNumeric) 
        {
            dbQuery = dbQuery.eq('student_id', parseInt(targetQuery));
        } 
        else 
        {
            dbQuery = dbQuery.eq('name', targetQuery);
        }

        const { data: students, error } = await dbQuery;

        if (error || !students || students.length === 0) 
        {
            await waitMsg.edit(`❌ DB에서 **${targetQuery}** 학생을 찾을 수 없습니다.`);
            return;
        }

        const student = students[0];

        if (isLookup) 
        {
            const [bjTier, jungolData] = await Promise.all([
                getSolvedAcTier(student.baekjoon_id),
                scrapeJungolProfile(student.jungol_id)
            ]);

            const jgTier = jungolData ? `${jungolData.tierStr} (${jungolData.rankStr})` : "미연동 또는 비공개";

            const profileEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🏆 O(1) 부원 정보: ${student.name}`)
                .setDescription(`학번: ${student.student_id} | 나이: ${student.age} | 성별: ${student.gender}`)
                .addFields(
                    { name: '백준 (Solved.ac)', value: `**${bjTier}**\n[프로필 보기](https://solved.ac/profile/${student.baekjoon_id})`, inline: true },
                    { name: '정올 (JUNGOL)', value: `**${jgTier}**\n[프로필 보기](https://jungol.co.kr/account/${student.jungol_id})`, inline: true }
                )
                .setFooter({ text: 'Powered by Enik 2.0 & O(1) Admin System' })
                .setTimestamp();

            await waitMsg.edit({ content: "조회 완료.", embeds: [profileEmbed] });
        } 
        else if (isRecommend) 
        {
            const recommendation = await getRecommendedProblems(student.baekjoon_id);
            
            const recEmbed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle(`📚 ${student.name} 맞춤형 문제 추천`)
                .setDescription(recommendation)
                .setFooter({ text: '열심히 하십시오.' });

            await waitMsg.edit({ content: "추천 완료.", embeds: [recEmbed] });
        }
        else if (isStat) 
        {
            const [bjStats, jgStats] = await Promise.all([
                getSolvedAcStats(student.baekjoon_id),
                getJungolStats(student.jungol_id)
            ]);

            const statEmbed = new EmbedBuilder()
                .setColor('#9900ff')
                .setTitle(`📊 ${student.name} 학생 통합 풀이 통계`)
                .setFooter({ text: '꾸준함이 실력입니다.' });

            if (bjStats) 
            {
                statEmbed.addFields(
                    { name: '🔥 백준 (Solved.ac)', value: `총 해결: **${bjStats.total}**문제\n(🟤${bjStats.counts.Bronze} ⚪${bjStats.counts.Silver} 🟡${bjStats.counts.Gold} 🟢${bjStats.counts.Platinum} 🔵${bjStats.counts.Diamond} 🔴${bjStats.counts.Ruby})`, inline: false }
                );
            } 
            else 
            {
                statEmbed.addFields({ name: '🔥 백준 (Solved.ac)', value: "미연동 또는 통계 조회 실패", inline: false });
            }

            if (jgStats && jgStats.total !== "확인 불가") 
            {
                statEmbed.addFields(
                    { name: '🚀 정올 (JUNGOL)', value: `총 해결: **${jgStats.total}**문제\n(정올은 자체 API 미지원으로 세부 티어 파싱이 생략되었습니다.)`, inline: false }
                );
            } 
            else 
            {
                statEmbed.addFields({ name: '🚀 정올 (JUNGOL)', value: "미연동 또는 비공개", inline: false });
            }

            await waitMsg.edit({ content: "통계 분석 완료.", embeds: [statEmbed] });
        }

    } 
    catch (error: any) 
    {
        console.error("[치명적 에러 발생]:", error.message);
        message.reply("서버에 일시적인 오류가 발생했습니다. (대장님, 터미널 로그를 확인해 주세요!)");
    }
});

client.login(DISCORD_TOKEN);