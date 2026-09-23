export function buildBulkDeliverabilityHeaders(input: {
  campaignId: string;
  sendingAccountId: string;
  listId?: string | null;
  senderDomain: string;
  unsubscribeUrl: string;
}) {
  const campaign = input.campaignId.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const account = input.sendingAccountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const senderDomain = input.senderDomain.trim().toLowerCase();
  const unsubscribeUrl = input.unsubscribeUrl.trim();

  const headers = [
    `Feedback-ID: ${campaign}:${account}:marketing:neximail`,
  ];

  const list = String(input.listId || "").replace(/[^A-Za-z0-9]/g, "");
  if (list && senderDomain) headers.push(`List-ID: <${list}.${senderDomain}>`);

  headers.push(
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
  );

  return headers;
}
