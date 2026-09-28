export type TrackingLinkSigner = (payload: { messageId: string; url: string }) => Promise<string>;

const ANCHOR_OPEN_TAG = /<a\b[^>]*>/gi;
const HREF_ATTRIBUTE = /(\s)(href)(\s*=\s*)(["'])(https?:\/\/[^"']+)\4/i;

function shouldSkipTarget(target: string, appUrl: string) {
  return target.startsWith(`${appUrl}/unsubscribe/`) || target.startsWith(`${appUrl}/tracking/`);
}

/**
 * Rewrites only clickable HTML anchor href attributes.
 *
 * Resource URLs such as <link href="...">, <img src="..."> and <script src="...">
 * are deliberately left untouched so resource fetching cannot generate false clicks.
 */
export async function rewriteTrackingLinks(
  html: string,
  appUrl: string,
  messageId: string,
  signToken: TrackingLinkSigner,
) {
  if (!appUrl) return html;

  let output = html;
  const matches = [...html.matchAll(ANCHOR_OPEN_TAG)];

  for (const match of matches) {
    const tag = match[0];
    const hrefMatch = HREF_ATTRIBUTE.exec(tag);
    if (!hrefMatch) continue;

    const target = hrefMatch[5];
    if (shouldSkipTarget(target, appUrl)) continue;

    const token = await signToken({ messageId, url: target });
    const rewrittenTag = tag.replace(
      HREF_ATTRIBUTE,
      `${hrefMatch[1]}${hrefMatch[2]}${hrefMatch[3]}${hrefMatch[4]}${appUrl}/tracking/click/${token}${hrefMatch[4]}`,
    );
    output = output.replace(tag, rewrittenTag);
  }

  return output;
}
