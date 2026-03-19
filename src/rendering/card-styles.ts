import { CARD_STYLE_BASE } from './card-style-base';
import { CARD_STYLE_EXTRA } from './card-style-extra';

export function getCardStyles(): string {
  return `
${CARD_STYLE_BASE}
${CARD_STYLE_EXTRA}
  `;
}
