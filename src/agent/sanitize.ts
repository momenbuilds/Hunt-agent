// Strip <think>...</think> blocks from model output. Some local models
// (Qwen, DeepSeek-R1, GLM) emit visible reasoning blocks that aren't
// meant for the end user.

const THINK_BLOCK_RE = /<think>[\s\S]*?(?:<\/think>|$)\s*/gi;
const DANGLING_THINK_CLOSE_RE = /^\s*<\/think>\s*/i;

export function stripThinkingTags(s: string): string {
  if (!/<\/?think>/i.test(s)) return s;
  return s.replace(THINK_BLOCK_RE, '').replace(DANGLING_THINK_CLOSE_RE, '').trimStart();
}
