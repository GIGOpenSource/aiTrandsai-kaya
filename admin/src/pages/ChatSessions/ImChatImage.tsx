import { Image } from 'antd';
import { resolveAdminMediaUrl } from '../../utils/mediaUrl';
import { imMessageImageUrl, isImImageMessage } from './imApi';
import type { ChatSessionMessage } from '../../types';

export function ImChatImage({ url }: { url: string }) {
  const src = resolveAdminMediaUrl(url);
  if (!src) return null;
  return (
    <Image
      src={src}
      style={{ maxWidth: 220, maxHeight: 280, borderRadius: 8, display: 'block' }}
    />
  );
}

export function ImMessageContent({
  msg,
  text,
}: {
  msg: ChatSessionMessage;
  text?: string;
}) {
  const imageUrl = imMessageImageUrl(msg);
  const showText = String(text ?? msg.content ?? '').trim();
  const hideText = isImImageMessage(msg) && !showText;
  return (
    <>
      {hideText ? null : (
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text ?? msg.content}</div>
      )}
      {imageUrl ? (
        <div style={{ marginTop: hideText ? 0 : 8 }}>
          <ImChatImage url={imageUrl} />
        </div>
      ) : null}
    </>
  );
}
