import { Envelope, ApiResult, createEnvelope, MessageType } from '../background/types/protocol';

export async function sendMessage<T, R>(
  type: MessageType,
  payload: T,
  source: Envelope['source'] = 'content-script'
): Promise<R> {
  const envelope = createEnvelope(type, payload, source);
  const result = await chrome.runtime.sendMessage<Envelope<T>, ApiResult<R>>(envelope);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.data;
}

export async function sendMessageFromPopup<T, R>(type: MessageType, payload: T): Promise<R> {
  return sendMessage(type, payload, 'popup');
}
