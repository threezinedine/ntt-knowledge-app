import type { PromptLanguage } from '../ai/copyPrompt';
import { WHYS_FORMAT, type NodeEdges, type WhyItem, type WhySession } from '@km/core';

/**
 * The prompt the user pastes into any AI chat to run a 5 Whys session on a
 * node. The app calls no AI itself; the chat's last reply (on "end") is the
 * km-whys/1 JSON that `parseWhysText` reads back.
 *
 * The prompt's language is chosen in the dialog, independently of the UI
 * language, so both versions live here as data rather than in the i18n files.
 */
export { PROMPT_LANGUAGES, type PromptLanguage } from '../ai/copyPrompt';

export interface PromptInput {
  title: string;
  content: string;
  edges: NodeEdges | undefined;
  /** Earlier sessions of this node, so the AI doesn't ask the same again. */
  sessions: readonly Pick<WhySession, 'summary' | 'conclusion' | 'whys'>[];
}

/** The chat commands the prompt teaches, shown in the in-app guide too. */
export const WHYS_COMMANDS = {
  deeper: { en: 'deeper', vi: 'đào sâu' },
  next: { en: 'next', vi: 'góc khác' },
  end: { en: 'end', vi: 'kết thúc' },
} as const;

const EXAMPLE = (lang: PromptLanguage) =>
  JSON.stringify(
    {
      format: WHYS_FORMAT,
      summary: lang === 'vi' ? '2–4 câu tóm tắt cả phiên' : '2–4 sentences on the whole session',
      conclusion:
        lang === 'vi'
          ? 'Nguyên nhân gốc / điều mình cần sửa hoặc nghĩ lại'
          : 'The root cause / what I should fix or rethink',
      whys: [
        {
          question: lang === 'vi' ? 'Tại sao …?' : 'Why …?',
          answer: lang === 'vi' ? 'Câu trả lời của mình' : 'My answer',
          takeaway: lang === 'vi' ? 'Ý chính, một dòng' : 'One-line takeaway',
          children: [
            {
              question: lang === 'vi' ? 'Tại sao … (sâu hơn)?' : 'Why … (deeper)?',
              answer: '',
              takeaway: '',
              children: [],
            },
          ],
        },
      ],
    },
    null,
    2,
  );

const TEXT = {
  en: {
    intro:
      'You are my critical-thinking partner. Use the "5 Whys" method to challenge what I wrote in my notes below. Your job is to question it, not to agree with it, explain it or teach me.',
    topic: '# My topic',
    title: 'Title',
    notes: 'My notes (between the markers):',
    empty: '(no notes yet: challenge the title itself)',
    related: 'Related notes (links to and from this one), for context:',
    earlier:
      "My earlier 5 Whys sessions on this topic, in full (a deeper why is indented under the one it digs into). Don't ask the same again: build on my answers, dig where I stopped, or pick other points:",
    session: 'Session',
    summary: 'Summary',
    conclusion: 'Conclusion',
    answer: 'My answer',
    unanswered: '(not answered)',
    takeaway: 'Takeaway',
    rules: '# How we play',
    rule1:
      'Ask exactly ONE "why" question per message. Aim it at one specific claim, assumption or gap in my notes, and quote the words you are challenging. Keep it short. Do not answer it yourself, and do not explain or lecture.',
    rule2:
      'I answer. Then, unless I type a command, ask the next "why" about MY ANSWER (one level deeper), the way 5 Whys digs down to a root cause.',
    rule3: 'Commands I may type, alone or after my answer:',
    deeper: 'dig deeper into my last answer (a deeper why under the current one).',
    next: 'leave this chain and challenge a different point of my notes (a new top-level why).',
    end: 'stop and output the summary described below.',
    rule4:
      'If my answer is vague, contradicts my notes or just restates the question, say so in one short sentence before your next why.',
    rule5: 'There is no limit on the number of whys. Keep going until I type "end".',
    rule6: 'Write in English.',
    start: 'Start now with your first why, no preamble.',
    endTitle: '# When I type "end"',
    endIntro:
      'Reply with ONLY one ```json code block (nothing before or after it), in exactly this format:',
    jsonRules: 'Rules for the JSON:',
    j1: '"whys" is the tree of what we did: a why I dug deeper into has its deeper whys in "children"; a why started with "next" is a new item at the top level.',
    j2: '"question": your question, as you asked it.',
    j3: '"answer": my answer in my own words (fix typos and trim filler, but add nothing I didn\'t say). Use "" if I didn\'t answer.',
    j4: '"takeaway": one line on what this why revealed.',
    j5: '"summary": 2–4 sentences on what we examined and found. "conclusion": the root cause, or the main thing I should fix or rethink in my notes.',
    j6: 'Keep "format" as is. Valid JSON only: double quotes, no comments, no trailing commas.',
  },
  vi: {
    intro:
      'Bạn là người phản biện của mình. Hãy dùng phương pháp "5 Whys" để vặn lại những gì mình viết trong ghi chú bên dưới. Việc của bạn là chất vấn, không phải đồng ý, giải thích hay giảng bài.',
    topic: '# Chủ đề của mình',
    title: 'Tiêu đề',
    notes: 'Ghi chú của mình (nằm giữa hai dấu mốc):',
    empty: '(chưa có ghi chú: hãy vặn chính tiêu đề)',
    related: 'Các ghi chú liên quan (liên kết đến và đi từ ghi chú này), để bạn hiểu bối cảnh:',
    earlier:
      'Các phiên 5 Whys trước của mình về chủ đề này, đầy đủ (câu why sâu hơn thụt vào dưới câu nó đào vào). Đừng hỏi lại y như cũ: hãy dựa vào câu trả lời của mình, đào tiếp chỗ mình dừng, hoặc chọn ý khác:',
    session: 'Phiên',
    summary: 'Tóm tắt',
    conclusion: 'Kết luận',
    answer: 'Mình trả lời',
    unanswered: '(chưa trả lời)',
    takeaway: 'Ý chính',
    rules: '# Luật chơi',
    rule1:
      'Mỗi tin nhắn chỉ hỏi ĐÚNG MỘT câu "tại sao". Nhắm vào một khẳng định, giả định hoặc lỗ hổng cụ thể trong ghi chú, và trích nguyên văn đoạn bạn đang vặn. Hỏi ngắn gọn. Không tự trả lời, không giải thích, không giảng.',
    rule2:
      'Mình trả lời. Sau đó, nếu mình không gõ lệnh, hãy hỏi câu "tại sao" tiếp theo về CÂU TRẢ LỜI CỦA MÌNH (sâu thêm một tầng), đúng cách 5 Whys đào tới nguyên nhân gốc.',
    rule3: 'Các lệnh mình có thể gõ, riêng hoặc sau câu trả lời:',
    deeper: 'đào sâu vào câu trả lời vừa rồi (một câu why sâu hơn, nằm dưới câu hiện tại).',
    next: 'bỏ chuỗi này, vặn một ý khác trong ghi chú (một câu why mới ở tầng gốc).',
    end: 'dừng lại và xuất bản tổng hợp như mô tả bên dưới.',
    rule4:
      'Nếu câu trả lời của mình mơ hồ, mâu thuẫn với ghi chú hoặc chỉ nhắc lại câu hỏi, hãy nói thẳng trong một câu ngắn trước khi hỏi tiếp.',
    rule5: 'Không giới hạn số câu why. Cứ tiếp tục cho đến khi mình gõ "kết thúc".',
    rule6: 'Viết bằng tiếng Việt.',
    start: 'Bắt đầu ngay với câu why đầu tiên, không cần mở đầu.',
    endTitle: '# Khi mình gõ "kết thúc"',
    endIntro:
      'CHỈ trả lời bằng một khối ```json duy nhất (không có gì trước hay sau nó), đúng định dạng này:',
    jsonRules: 'Quy tắc cho JSON:',
    j1: '"whys" là cây của những gì đã hỏi: câu why mà mình đào sâu thì các câu sâu hơn nằm trong "children"; câu why bắt đầu bằng "góc khác" là một mục mới ở tầng gốc.',
    j2: '"question": câu hỏi của bạn, đúng như đã hỏi.',
    j3: '"answer": câu trả lời của mình, bằng lời của mình (sửa lỗi gõ, bỏ từ thừa, nhưng không thêm ý mình không nói). Để "" nếu mình không trả lời.',
    j4: '"takeaway": một dòng về điều câu why này làm lộ ra.',
    j5: '"summary": 2–4 câu về những gì đã xem xét và tìm ra. "conclusion": nguyên nhân gốc, hoặc điều chính mình cần sửa hay nghĩ lại trong ghi chú.',
    j6: 'Giữ nguyên "format". Chỉ JSON hợp lệ: dấu nháy kép, không chú thích, không dấu phẩy thừa.',
  },
} satisfies Record<PromptLanguage, Record<string, string>>;

/** Multi-line text on one line, so it can't break the indented list. */
const one = (text: string) => text.replace(/\s*\n\s*/g, ' ');

/** A why and everything under it, one indented line per field. */
function whyLines(
  items: readonly WhyItem[],
  prefix: string,
  x: (typeof TEXT)[PromptLanguage],
): string[] {
  return items.flatMap((w, i) => {
    const path = `${prefix}${String(i + 1)}`;
    const pad = '  '.repeat(path.split('.').length);
    return [
      `${pad}${path}. ${one(w.question)}`,
      `${pad}   ${x.answer}: ${w.answer ? one(w.answer) : x.unanswered}`,
      ...(w.takeaway ? [`${pad}   ${x.takeaway}: ${one(w.takeaway)}`] : []),
      ...whyLines(w.children, `${path}.`, x),
    ];
  });
}

export function buildWhysPrompt(input: PromptInput, lang: PromptLanguage): string {
  const x = TEXT[lang];
  const cmd = (k: keyof typeof WHYS_COMMANDS) =>
    `"${WHYS_COMMANDS[k][lang]}"${lang === 'vi' ? ` (hoặc "${WHYS_COMMANDS[k].en}")` : ''}`;
  const lines: string[] = [x.intro, '', x.topic, `${x.title}: ${input.title}`, '', x.notes];
  lines.push('<<<NOTES', input.content.trim() || x.empty, 'NOTES>>>');

  const out = input.edges?.outgoing ?? [];
  const inc = input.edges?.incoming ?? [];
  if (out.length + inc.length > 0) {
    lines.push('', x.related);
    for (const e of out) lines.push(`- ${input.title} -[${e.edge.name}]-> ${e.neighbor.title}`);
    for (const e of inc) lines.push(`- ${e.neighbor.title} -[${e.edge.name}]-> ${input.title}`);
  }

  if (input.sessions.length > 0) {
    lines.push('', x.earlier);
    input.sessions.forEach((s, i) => {
      lines.push(`- ${x.session} ${String(i + 1)}`);
      if (s.summary) lines.push(`  ${x.summary}: ${one(s.summary)}`);
      if (s.conclusion) lines.push(`  ${x.conclusion}: ${one(s.conclusion)}`);
      lines.push(...whyLines(s.whys, '', x));
    });
  }

  lines.push(
    '',
    x.rules,
    `1. ${x.rule1}`,
    `2. ${x.rule2}`,
    `3. ${x.rule3}`,
    `   - ${cmd('deeper')}: ${x.deeper}`,
    `   - ${cmd('next')}: ${x.next}`,
    `   - ${cmd('end')}: ${x.end}`,
    `4. ${x.rule4}`,
    `5. ${x.rule5}`,
    `6. ${x.rule6}`,
    '',
    x.endTitle,
    x.endIntro,
    '```json',
    EXAMPLE(lang),
    '```',
    x.jsonRules,
    `- ${x.j1}`,
    `- ${x.j2}`,
    `- ${x.j3}`,
    `- ${x.j4}`,
    `- ${x.j5}`,
    `- ${x.j6}`,
    '',
    x.start,
  );
  return lines.join('\n');
}
