/* Pure notification formatting and idempotency helpers for verified receipts. */

import {validateReceipt} from './post-deploy.mjs';

export function notificationKey(receipt) {
  validateReceipt(receipt, {requireFinal: true});
  if (receipt.final_status !== 'verified') throw new Error('notification requires a verified receipt');
  return receipt.idempotency_key;
}

export function notificationMarker(receipt) {
  return `<!-- ai-news-production-notification:${notificationKey(receipt)} -->`;
}

export function shouldNotify(receipt, issues) {
  const marker = notificationMarker(receipt);
  return !(issues || []).some(issue => String(issue?.body || '').includes(marker));
}

export function buildNotification(receipt, latest = {}) {
  validateReceipt(receipt, {requireFinal: true});
  if (receipt.final_status !== 'verified') throw new Error('notification requires a verified receipt');
  const data = latest && typeof latest.data === 'object' ? latest.data : {};
  const counts = Object.entries(data).map(([category, items]) => [category, Array.isArray(items) ? items.length : 0]);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const action = receipt.kind === 'rollback' ? 'Cloudflare 回滾已驗證' : 'Cloudflare production 已驗證';
  const title = `✅ ${action} · ${total} 筆 · ${receipt.expected.release_id.slice(0, 18)}…`;
  const rows = counts.map(([category, count]) => `| ${category} | ${count} |`).join('\n');
  const body = [
    notificationMarker(receipt),
    `## ${action}`,
    '',
    '| 證據 | 值 |',
    '|---|---|',
    `| 驗證結果 | verified |`,
    `| 部署 SHA | \`${receipt.deploy_sha}\` |`,
    `| Release ID | \`${receipt.expected.release_id}\` |`,
    `| Content set SHA-256 | \`${receipt.expected.content_set_sha256}\` |`,
    `| Production URL | ${receipt.production_url} |`,
    `| Receipt ID | \`${receipt.receipt_id}\` |`,
    '',
    ...(rows ? ['## 發布內容', '', '| 分類 | 筆數 |', '|---|---:|', rows, ''] : []),
    `[前往 AI News Hub](${receipt.production_url}/)`,
  ].join('\n');
  return {title, body};
}
