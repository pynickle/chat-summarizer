function getEmojiCodePoint(emoji: string): string | null {
  try {
    const codePoints = [];
    let i = 0;

    while (i < emoji.length) {
      const code = emoji.codePointAt(i);
      if (code) {
        if (code !== 0xfe0f && code !== 0x200d) {
          codePoints.push(code.toString(16));
        }
        if (code > 0xffff) {
          i += 2;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    }

    let result = codePoints.join('-');
    if (
      result.includes('1f3fb') ||
      result.includes('1f3fc') ||
      result.includes('1f3fd') ||
      result.includes('1f3fe') ||
      result.includes('1f3ff')
    ) {
      result = codePoints[0];
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function convertEmojiToImages(html: string): string {
  const emojiBaseUrl = 'https://cdn.bootcdn.net/ajax/libs/twemoji/16.0.1/72x72/';
  const emojiRegex =
    /(?:[\u2600-\u26FF\u2700-\u27BF]|(?:\uD83C[\uDF00-\uDFFF])|(?:\uD83D[\uDC00-\uDE4F])|(?:\uD83D[\uDE80-\uDEFF])|(?:\uD83E[\uDD00-\uDDFF])|(?:\uD83E[\uDE00-\uDEFF])|(?:\uD83C[\uDDE6-\uDDFF])|(?:\uD83C[\uDDF0-\uDDFF])|[\u23E9-\u23F3\u23F8-\u23FA\u2600-\u2604\u260E\u2611\u2614-\u2615\u2618\u261D\u2620\u2622-\u2623\u2626\u262A\u262E-\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u2660\u2663\u2665-\u2666\u2668\u267B\u267F\u2692-\u2697\u2699\u269B-\u269C\u26A0-\u26A1\u26AA-\u26AB\u26B0-\u26B1\u26BD-\u26BE\u26C4-\u26C5\u26C8\u26CE-\u26CF\u26D1\u26D3-\u26D4\u26E9-\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733-\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763-\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934-\u2935\u2B05-\u2B07\u2B1B-\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|(?:\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F))/g;

  return html.replace(emojiRegex, (match) => {
    try {
      const codePoint = getEmojiCodePoint(match);
      if (!codePoint) {
        return match;
      }

      const escapedMatch = match.replace(/["'<>&]/g, (char) => {
        switch (char) {
          case '"':
            return '&quot;';
          case "'":
            return '&#39;';
          case '<':
            return '&lt;';
          case '>':
            return '&gt;';
          case '&':
            return '&amp;';
          default:
            return char;
        }
      });

      return `<img class="emoji" src="${emojiBaseUrl}${codePoint}.png" alt="${escapedMatch}" loading="eager" onerror="this.style.display='none'">`;
    } catch {
      return match;
    }
  });
}
