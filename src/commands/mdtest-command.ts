import { Session, h } from 'koishi';
import { deleteMessageBestEffort, generateTestMarkdown } from './common';
import { CommandDeps } from './types';

export async function handleMdTestCommand(deps: CommandDeps, session: Session): Promise<void> {
  const { mdToImageService, sendMessage } = deps;

  try {
    const tempMessage = await sendMessage(session, [
      h.text('🔄 正在生成 Markdown 测试图片，请稍候...'),
    ]);
    const testMarkdown = generateTestMarkdown();
    const imageBuffer = await mdToImageService.convertToImage(testMarkdown);

    await deleteMessageBestEffort(session, tempMessage?.[0]);

    await sendMessage(session, [
      h.text('🎨 Markdown 和 Emoji 渲染测试结果：'),
      h.image(imageBuffer, 'image/png'),
    ]);
  } catch (error: any) {
    console.error('Markdown 测试失败：', error);
    await sendMessage(session, [h.text(`❌ Markdown 测试失败：${error?.message || '未知错误'}`)]);
  }
}
