export const CARD_STYLE_EXTRA = `
      .important-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid #f0f0f0;
      }

      .important-item:last-child {
        border-bottom: none;
      }

      .info-type-icon {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
      }

      .type-announcement {
        background: #f0f0f0;
      }

      .type-link {
        background: #e8e8e8;
      }

      .type-resource {
        background: #f5f5f5;
      }

      .type-decision {
        background: #ebebeb;
      }

      .type-other {
        background: #f3f4f6;
      }

      .info-content {
        flex: 1;
        font-size: 14px;
        color: #333;
        line-height: 1.6;
      }

      .info-source {
        font-size: 12px;
        color: #888;
        margin-top: 4px;
      }

      .quote-item {
        padding: 16px;
        background: #fafafa;
        border-radius: 12px;
        margin-bottom: 12px;
        position: relative;
      }

      .quote-item:last-child {
        margin-bottom: 0;
      }

      .quote-mark {
        position: absolute;
        top: 8px;
        left: 12px;
        font-size: 32px;
        color: #1a1a1a;
        opacity: 0.15;
      }

      .quote-content {
        font-size: 15px;
        color: #333;
        line-height: 1.7;
        padding-left: 20px;
        font-style: italic;
      }

      .quote-author {
        text-align: right;
        font-size: 13px;
        color: #666;
        margin-top: 8px;
      }

      .ranking-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid #f5f5f5;
      }

      .ranking-item:last-child {
        border-bottom: none;
      }

      .rank-badge {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        flex-shrink: 0;
      }

      .rank-1 {
        background: linear-gradient(135deg, #ffd700, #ffb800);
        color: #704c00;
      }

      .rank-2 {
        background: linear-gradient(135deg, #e0e0e0, #c0c0c0);
        color: #555;
      }

      .rank-3 {
        background: linear-gradient(135deg, #cd7f32, #b87333);
        color: white;
      }

      .rank-other {
        background: #f0f0f0;
        color: #888;
      }

      .ranking-info {
        flex: 1;
        min-width: 0;
      }

      .ranking-username {
        font-size: 15px;
        font-weight: 500;
        color: #333;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ranking-bar {
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        margin-top: 6px;
        overflow: hidden;
      }

      .ranking-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #1a1a1a, #404040);
        border-radius: 3px;
        transition: width 0.3s;
      }

      .ranking-count {
        font-size: 14px;
        font-weight: 600;
        color: #1a1a1a;
        flex-shrink: 0;
      }

      .hourly-chart {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        height: 120px;
        padding: 0 4px;
        margin-bottom: 16px;
      }

      .hour-bar {
        flex: 1;
        margin: 0 2px;
        background: linear-gradient(180deg, #1a1a1a 0%, #404040 100%);
        border-radius: 4px 4px 0 0;
        min-height: 4px;
        position: relative;
      }

      .hour-bar:hover {
        opacity: 0.8;
      }

      .hour-labels {
        display: flex;
        justify-content: space-between;
        padding: 0 4px;
      }

      .hour-label {
        font-size: 10px;
        color: #888;
        text-align: center;
        width: 24px;
      }

      .peak-summary {
        margin-top: 12px;
        padding: 10px 14px;
        background: #fafafa;
        border-radius: 8px;
        font-size: 14px;
        color: #555;
      }

      .interaction-section {
        margin-bottom: 16px;
      }

      .interaction-section:last-child {
        margin-bottom: 0;
      }

      .interaction-title {
        font-size: 14px;
        font-weight: 600;
        color: #555;
        margin-bottom: 10px;
      }

      .interaction-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #fafafa;
        border-radius: 8px;
        margin-bottom: 6px;
        font-size: 14px;
      }

      .interaction-from {
        color: #1a1a1a;
        font-weight: 500;
      }

      .interaction-arrow {
        color: #ccc;
      }

      .interaction-to {
        color: #333333;
        font-weight: 500;
      }

      .interaction-count {
        margin-left: auto;
        background: #e8e8e8;
        color: #333333;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 500;
      }

      .empty-state {
        text-align: center;
        padding: 20px;
        color: #888;
        font-size: 14px;
      }

      .footer {
        text-align: center;
        padding: 16px;
        color: #999999;
        font-size: 12px;
      }

      .card.hidden {
        display: none;
      }

      .emoji {
        display: inline-block;
        width: 1.2em;
        height: 1.2em;
        vertical-align: -0.15em;
        margin: 0 0.05em;
        object-fit: contain;
      }

      .card-title .emoji {
        width: 1.1em;
        height: 1.1em;
      }

      .header-title .emoji {
        width: 1em;
        height: 1em;
      }
`;
