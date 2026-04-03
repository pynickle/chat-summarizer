import { Session, h } from 'koishi';

export async function deleteMessageBestEffort(session: Session, messageId?: string): Promise<void> {
  if (!messageId) {
    return;
  }

  try {
    await session.bot.deleteMessage(session.channelId, messageId);
  } catch {
    return;
  }
}

export function parseDate(dateInput: string): string | null {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let targetDate: Date;

    switch (dateInput.toLowerCase()) {
      case 'today':
        targetDate = today;
        break;
      case 'yesterday':
        targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() - 1);
        break;
      case 'last7days':
        targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() - 7);
        break;
      default:
        if (dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
          targetDate = new Date(dateInput + 'T00:00:00');
        } else if (dateInput.match(/^\d{2}-\d{2}$/)) {
          targetDate = new Date(`${now.getFullYear()}-${dateInput}T00:00:00`);
        } else {
          return null;
        }
    }

    if (isNaN(targetDate.getTime())) {
      return null;
    }

    return targetDate.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

export async function sendSummaryAsForward(
  session: Session,
  exportMessage: string,
  summary: string,
  sendMessage: (session: Session, content: any[]) => Promise<string[]>
): Promise<void> {
  try {
    const forwardMessages = [
      h('message', {}, [h.text('✅ 导出成功！')]),
      h('message', {}, [h.text(exportMessage)]),
      h('message', {}, [h.text('🤖 AI 总结'), h.text('\n\n' + summary)]),
    ];

    const forwardContent = h('message', { forward: true }, forwardMessages);
    await session.send(forwardContent);
  } catch {
    const fullMessage = exportMessage + '\n\n🤖 AI 总结:\n' + summary;
    await sendMessage(session, [h.text(fullMessage)]);
  }
}

export function extractMessageCount(message: string): number {
  const match = message.match(/📊 消息数量: (\d+) 条/);
  return match ? parseInt(match[1]) : 0;
}

export function generateTestMarkdown(): string {
  const testMarkdown = [
    '# 🎯 Markdown 渲染测试',
    '',
    '## 📝 文本格式测试',
    '',
    '这是**粗体文字**，这是*斜体文字*，这是***粗斜体文字***。',
    '',
    '## 😀 Emoji 测试',
    '',
    '### 表情符号',
    '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳',
    '',
    '### 手势和人物',
    '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏',
    '',
    '### 动物和自然',
    '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪲 🐛 🦋 🐌 🐞 🐜 🪰 🪱 🦗',
    '',
    '### 食物和饮料',
    '🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠',
    '',
    '### 活动和物品',
    '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️',
    '',
    '## 📋 列表测试',
    '',
    '### 无序列表',
    '* 这是第一项 🥇',
    '* 这是第二项 🥈',
    '* 这是第三项 🥉',
    '',
    '### 有序列表',
    '1. 首先做这个 📝',
    '2. 然后做那个 ✅',
    '3. 最后完成 🎉',
    '',
    '## 💻 代码测试',
    '',
    "这是行内代码：`console.log('Hello World! 🌍')`",
    '',
    '```javascript',
    '// 这是代码块测试',
    'function greet(name) {',
    '    return `Hello ${name}! 👋`;',
    '}',
    '',
    "const message = greet('世界');",
    'console.log(message); // 输出：Hello 世界！👋',
    '```',
    '',
    '```python',
    '# Python 代码示例',
    'def calculate_emoji_count(text):',
    '    """计算文本中 emoji 的数量 📊"""',
    '    emoji_count = 0',
    '    for char in text:',
    '        if ord(char) > 0x1F600:  # 基本 emoji 范围',
    '            emoji_count += 1',
    '    return emoji_count',
    '',
    'text = "Hello 世界！😊🎉🚀"',
    'count = calculate_emoji_count(text)',
    'print(f"Emoji 数量：{count} 个")',
    '```',
    '',
    '## 🔗 链接测试',
    '',
    '这是一个链接：[Koishi 官网](https://koishi.chat) 🌐',
    '',
    '## 🌍 多语言测试',
    '',
    '### 中文',
    '你好世界！这是中文测试内容。🇨🇳',
    '',
    '### English',
    'Hello World! This is English test content. 🇺🇸',
    '',
    '### 日本語',
    'こんにちは世界！これは日本語のテストコンテンツです。🇯🇵',
    '',
    '### 한국어',
    '안녕하세요 세계! 이것은 한국어 테스트 콘텐츠입니다. 🇰🇷',
    '',
    '## 🎨 符号和特殊字符',
    '',
    '### 箭头符号',
    '↑ ↓ ← → ↖ ↗ ↘ ↙ ⬆ ⬇ ⬅ ➡ ↩ ↪ ⤴ ⤵',
    '',
    '### 数学符号',
    '± × ÷ = ≠ ≈ ∞ ∫ ∑ √ ∆ ∇ ∂ ∞ ∅ ∈ ∉ ⊂ ⊃ ∩ ∪',
    '',
    '### 货币符号',
    '$ € ¥ £ ₹ ₽ ₿ ¢ ₩ ₪ ₫ ₡ ₵ ₼ ₴ ₦ ₨ ₱',
    '',
    '## ⭐ 结论',
    '',
    '如果你能看到以上所有内容都正确渲染，包括：',
    '- ✅ 各种 emoji 正确显示（非乱码）',
    '- ✅ 中英日韩文字正确显示',
    '- ✅ 代码块语法高亮',
    '- ✅ 列表格式正确',
    '- ✅ 粗体斜体效果正确',
    '',
    '那么 Markdown 渲染功能工作正常！🎉✨',
    '',
    '---',
    `*测试时间：${new Date().toLocaleString('zh-CN')} ⏰*`,
  ];

  return testMarkdown.join('\n');
}
