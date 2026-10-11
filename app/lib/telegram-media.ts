type TelegramFileResponse = { ok?: boolean; result?: { file_path?: string } };

type TelegramMessage = {
  photo?: Array<{ file_id: string; width?: number; height?: number }>;
  document?: { file_id: string; mime_type?: string; file_name?: string };
  caption?: string;
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  return btoa(binary);
}

export async function fetchTelegramImage(token: string, message: TelegramMessage) {
  const photo = message.photo?.at(-1);
  const document = message.document && message.document.mime_type?.startsWith("image/") ? message.document : null;
  const fileId = photo?.file_id || document?.file_id;
  if (!fileId) return null;
  const fileResult = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(8000) });
  const fileJson = await fileResult.json() as TelegramFileResponse;
  const path = fileJson.result?.file_path;
  if (!fileResult.ok || !fileJson.ok || !path) return null;
  const mediaResponse = await fetch(`https://api.telegram.org/file/bot${encodeURIComponent(token)}/${path}`, { signal: AbortSignal.timeout(12000) });
  if (!mediaResponse.ok) return null;
  const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return null;
  const mimeType = document?.mime_type || (path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  return { data: `data:${mimeType};base64,${toBase64(bytes)}`, mimeType, fileId };
}

export function telegramContentType(message: TelegramMessage) {
  if (message.photo) return "image";
  if (message.document) return message.document.mime_type || "document";
  return "text";
}
