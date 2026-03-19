export const CARD_STYLE_BASE = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: Maple Mono NF CN, "Segoe UI", sans-serif;
        background: #f5f5f7;
        min-height: 100vh;
      }

      .daily-report-container {
        max-width: 720px;
        margin: 0 auto;
        padding: 40px;
        background: #f5f5f7;
      }

      .card {
        background: #ffffff;
        border-radius: 16px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
        margin-bottom: 16px;
        padding: 20px 24px;
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.04);
      }

      .card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, #1a1a1a, #404040);
      }

      .card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 18px;
        font-weight: 700;
        color: #1a1a1a;
        margin-bottom: 16px;
      }

      .card-title .icon {
        font-size: 20px;
      }

      .header-card {
        background: linear-gradient(135deg, #1a1a1a 0%, #333333 100%);
        color: white;
        text-align: center;
        padding: 32px 24px;
      }

      .header-card::before {
        display: none;
      }

      .header-title {
        font-size: 28px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      .header-date {
        font-size: 16px;
        opacity: 0.8;
        margin-bottom: 20px;
      }

      .header-stats {
        display: flex;
        justify-content: center;
        gap: 40px;
      }

      .stat-item {
        text-align: center;
      }

      .stat-value {
        font-size: 32px;
        font-weight: 700;
      }

      .stat-label {
        font-size: 14px;
        opacity: 0.7;
      }

      .summary-overview {
        font-size: 16px;
        line-height: 1.8;
        color: #333;
        margin-bottom: 16px;
        padding: 12px 16px;
        background: #fafafa;
        border-radius: 8px;
        border-left: 4px solid #1a1a1a;
      }

      .summary-highlights {
        margin-bottom: 16px;
      }

      .highlight-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 0;
        color: #444;
        font-size: 15px;
        line-height: 1.6;
      }

      .highlight-bullet {
        color: #1a1a1a;
        font-weight: bold;
      }

      .atmosphere-tag {
        display: inline-block;
        padding: 6px 16px;
        background: #1a1a1a;
        color: white;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 500;
      }

      .hot-topic {
        padding: 14px 16px;
        background: #fafafa;
        border-radius: 12px;
        margin-bottom: 12px;
      }

      .hot-topic:last-child {
        margin-bottom: 0;
      }

      .hot-topic-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .hot-topic-name {
        font-size: 16px;
        font-weight: 600;
        color: #1a1a1a;
      }

      .heat-tag {
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }

      .heat-high {
        background: #1a1a1a;
        color: #ffffff;
      }

      .heat-medium {
        background: #e5e5e5;
        color: #333333;
      }

      .heat-low {
        background: #f5f5f5;
        color: #666666;
      }

      .hot-topic-desc {
        font-size: 14px;
        color: #666;
        margin-bottom: 8px;
        line-height: 1.5;
      }

      .hot-topic-participants {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .participant-tag {
        padding: 2px 10px;
        background: #e8e8e8;
        color: #333333;
        border-radius: 12px;
        font-size: 12px;
      }
`;
