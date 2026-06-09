import type {
  JsonRecord,
} from './thinking_policy.js';
import {
  normalizeReasoningEffort,
  normalizeString,
  omitUndefined,
} from './thinking_policy_utils.js';

type InferredCodexPlusThinkingStyle =
  | 'default'
  | 'deepseek'
  | 'openrouter'
  | 'enable_thinking'
  | 'thinking'
  | 'reasoning_split'
  | 'low_high';

export function applyInferredCodexPlusThinkingPolicy(
  chat: JsonRecord,
  effort: string | null,
): JsonRecord {
  if (!effort) {
    return omitUndefined(chat);
  }
  const model = normalizeString(chat.model).toLowerCase();
  const style = inferCodexPlusThinkingStyle(model);
  const disabled = isDisabledReasoningEffort(effort);

  if (style === 'openrouter') {
    const mapped = disabled ? 'none' : mapCodexPlusReasoningEffort(effort, style);
    if (mapped) {
      chat.reasoning = { effort: mapped };
    } else {
      delete chat.reasoning;
    }
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }
  if (style === 'enable_thinking') {
    chat.enable_thinking = !disabled;
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }
  if (style === 'thinking') {
    chat.thinking = { type: disabled ? 'disabled' : 'enabled' };
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }
  if (style === 'reasoning_split') {
    chat.reasoning_split = !disabled;
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }
  if (disabled) {
    delete chat.reasoning_effort;
    return omitUndefined(chat);
  }

  const mapped = mapCodexPlusReasoningEffort(effort, style);
  if (mapped && supportsCodexPlusReasoningEffort(model, style)) {
    chat.reasoning_effort = mapped;
  } else {
    delete chat.reasoning_effort;
  }
  return omitUndefined(chat);
}

function inferCodexPlusThinkingStyle(model: string): InferredCodexPlusThinkingStyle {
  if (model.includes('openrouter') || model.startsWith('openrouter/')) {
    return 'openrouter';
  }
  if (model.includes('deepseek')) {
    return 'deepseek';
  }
  if (
    model.includes('qwen')
    || model.includes('dashscope')
    || model.includes('bailian')
    || model.includes('siliconflow')
  ) {
    return 'enable_thinking';
  }
  if (
    model.includes('kimi')
    || model.includes('moonshot')
    || model.includes('glm')
    || model.includes('zhipu')
    || model.includes('z.ai')
    || model.includes('mimo')
  ) {
    return 'thinking';
  }
  if (model.includes('minimax')) {
    return 'reasoning_split';
  }
  if (model.includes('stepfun') || model.includes('step-3.5-flash-2603')) {
    return 'low_high';
  }
  return 'default';
}

function mapCodexPlusReasoningEffort(
  effort: string,
  style: InferredCodexPlusThinkingStyle,
): string | null {
  const normalized = normalizeReasoningEffort(effort);
  if (!normalized || isDisabledReasoningEffort(normalized)) {
    return null;
  }
  if (style === 'deepseek') {
    return normalized === 'max' || normalized === 'xhigh' ? 'max' : 'high';
  }
  if (style === 'low_high') {
    return normalized === 'minimal' || normalized === 'low' ? 'low' : 'high';
  }
  if (style === 'openrouter') {
    return ['max', 'xhigh'].includes(normalized)
      ? 'xhigh'
      : ['high', 'medium', 'low', 'minimal'].includes(normalized)
        ? normalized
        : null;
  }
  return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(normalized)
    ? normalized
    : null;
}

function supportsCodexPlusReasoningEffort(
  model: string,
  style: InferredCodexPlusThinkingStyle,
): boolean {
  return isOpenAIOFamilyModel(model)
    || isGptFiveOrNewerModel(model)
    || style === 'deepseek'
    || style === 'low_high';
}

function isDisabledReasoningEffort(effort: string): boolean {
  return ['none', 'off', 'disabled'].includes(normalizeString(effort).toLowerCase());
}

function isOpenAIOFamilyModel(model: string): boolean {
  return model.length > 1
    && model.startsWith('o')
    && Boolean(model.at(1)?.match(/[0-9]/u));
}

function isGptFiveOrNewerModel(model: string): boolean {
  const rest = model.startsWith('gpt-') ? model.slice(4) : '';
  const first = rest.at(0);
  return Boolean(first && /[0-9]/u.test(first) && first >= '5');
}
