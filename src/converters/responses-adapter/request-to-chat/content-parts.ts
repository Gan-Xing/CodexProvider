import type {
  OpenAICompatibleProviderCapabilities,
} from '../../../capabilities/thinking_policy.js';
import type {
  JsonRecord,
} from '../types.js';
import {
  normalizeArray,
  omitUndefined,
} from '../shared/json.js';
import {
  normalizeString,
} from '../shared/strings.js';
import {
  unsupportedInputPartToText,
} from './unsupported.js';

export function convertResponsesContentToChatContent(
  content: unknown,
  providerCapabilities: OpenAICompatibleProviderCapabilities | null | undefined = null,
): string | JsonRecord[] | null {
  if (typeof content === 'string') {
    return content;
  }
  const parts = normalizeArray(content)
    .map((part) => {
      const type = normalizeString(part?.type);
      if (type === 'input_text' || type === 'output_text' || type === 'text') {
        return {
          type: 'text',
          text: normalizeString(part?.text) || '',
        };
      }
      if (type === 'input_image' || type === 'image_url') {
        if (providerCapabilities?.multimodal?.supportsImageInput === false) {
          return unsupportedInputPartToText(part, 'image', providerCapabilities);
        }
        const imageUrl = normalizeString(part?.image_url)
          || normalizeString(part?.image_url?.url);
        if (!imageUrl) {
          return null;
        }
        if (imageUrl.startsWith('data:')
          && providerCapabilities?.multimodal?.supportsImageBase64Input === false) {
          return unsupportedInputPartToText(part, 'image', providerCapabilities);
        }
        if (!imageUrl.startsWith('data:')
          && providerCapabilities?.multimodal?.supportsImageUrlInput === false) {
          return unsupportedInputPartToText(part, 'image', providerCapabilities);
        }
        return {
          type: 'image_url',
          image_url: { url: imageUrl },
        };
      }
      if (type === 'input_file' || type === 'file') {
        if (providerCapabilities?.multimodal?.supportsFileInput === false) {
          return unsupportedInputPartToText(part, 'file', providerCapabilities);
        }
        const fileData = normalizeString(part?.file_data)
          || normalizeString(part?.file?.file_data);
        const fileId = normalizeString(part?.file_id)
          || normalizeString(part?.file?.file_id);
        const fileUrl = normalizeString(part?.file_url)
          || normalizeString(part?.file?.file_url);
        const filename = normalizeString(part?.filename)
          || normalizeString(part?.file?.filename);
        if (!fileData && !fileId && !fileUrl) {
          return null;
        }
        if (fileData && providerCapabilities?.multimodal?.supportsFileDataInput === false) {
          return unsupportedInputPartToText(part, 'file', providerCapabilities);
        }
        if (fileId && providerCapabilities?.multimodal?.supportsFileIdInput === false) {
          return unsupportedInputPartToText(part, 'file', providerCapabilities);
        }
        if (fileUrl && providerCapabilities?.multimodal?.supportsFileUrlInput === false) {
          return unsupportedInputPartToText(part, 'file', providerCapabilities);
        }
        return omitUndefined({
          type: 'file',
          file: omitUndefined({
            file_data: fileData || undefined,
            file_id: fileId || undefined,
            file_url: fileUrl || undefined,
            filename: filename || undefined,
          }),
        });
      }
      return null;
    })
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (parts.every((part: any) => part.type === 'text')) {
    return parts.map((part: any) => part.text).join('');
  }
  return parts;
}

export function instructionText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part.trim();
        }
        if (part && typeof part === 'object') {
          return normalizeString((part as JsonRecord).text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return normalizeString(value);
}
