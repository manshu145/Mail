function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function injectPreheader(html: string, preheader: string | null | undefined) {
  const value = String(preheader || "").replace(/[\r\n]+/g, " ").trim();
  if (!value) return html;

  const hidden = `<div style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:transparent">${escapeHtml(value)}&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;</div>`;
  const body = html.match(/<body(?:\s[^>]*)?>/i);
  if (!body || body.index === undefined) return `${hidden}${html}`;
  const insertAt = body.index + body[0].length;
  return `${html.slice(0, insertAt)}${hidden}${html.slice(insertAt)}`;
}
