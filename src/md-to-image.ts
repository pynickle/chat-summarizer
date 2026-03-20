import { Context, Logger } from 'koishi';
import { readFileSync } from 'fs';

export class MarkdownToImageService {
  private logger: Logger;
  private isRendering: boolean = false;
  private renderQueue: Array<() => Promise<void>> = [];

  constructor(private ctx: Context) {
    this.logger = ctx.logger('chat-summarizer:md-to-image');
  }

  /**
   * 检查是否正在渲染，避免并发渲染
   */
  private async waitForRenderSlot(): Promise<void> {
    if (!this.isRendering) {
      this.isRendering = true;
      return;
    }

    // 如果正在渲染，加入队列等待
    this.logger.info('渲染进程繁忙，加入等待队列...');
    return new Promise((resolve) => {
      this.renderQueue.push(async () => {
        this.isRendering = true;
        resolve();
      });
    });
  }

  /**
   * 释放渲染槽位
   */
  private releaseRenderSlot(): void {
    this.isRendering = false;

    // 处理队列中的下一个任务
    const nextTask = this.renderQueue.shift();
    if (nextTask) {
      this.logger.info('处理队列中的下一个渲染任务');
      nextTask();
    }
  }

  /**
   * 生成字体 CSS - 使用 Google Fonts CDN
   */
  private generateFontCSS(): string {
    return `
      /* Emoji 图片样式 */
      .emoji {
        display: inline-block;
        width: 1.2em;
        height: 1.2em;
        vertical-align: -0.125em;
        margin: 0 0.05em;
        object-fit: contain;
      }

      /* 确保 emoji 文本有正确的字体回退 */
      .emoji-text, span:has(> .emoji) {
        font-family: Maple Mono NF CN, "Segoe UI", sans-serif;
      }
    `;
  }

  /**
   * 将文本中的 emoji 转换为图片标签
   */
  private convertEmojiToImages(html: string): string {
    // 使用 BootCDN emoji 图片 - 国内访问更稳定
    const emojiBaseUrl = 'https://cdn.bootcdn.net/ajax/libs/twemoji/16.0.1/72x72/';

    // 使用更完整的 Unicode 范围匹配 emoji
    const emojiRegex =
      /(?:[\u2600-\u26FF\u2700-\u27BF]|(?:\uD83C[\uDF00-\uDFFF])|(?:\uD83D[\uDC00-\uDE4F])|(?:\uD83D[\uDE80-\uDEFF])|(?:\uD83E[\uDD00-\uDDFF])|(?:\uD83E[\uDE00-\uDEFF])|(?:\uD83C[\uDDE6-\uDDFF])|(?:\uD83C[\uDDF0-\uDDFF])|[\u23E9-\u23F3\u23F8-\u23FA\u2600-\u2604\u260E\u2611\u2614-\u2615\u2618\u261D\u2620\u2622-\u2623\u2626\u262A\u262E-\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u2660\u2663\u2665-\u2666\u2668\u267B\u267F\u2692-\u2697\u2699\u269B-\u269C\u26A0-\u26A1\u26AA-\u26AB\u26B0-\u26B1\u26BD-\u26BE\u26C4-\u26C5\u26C8\u26CE-\u26CF\u26D1\u26D3-\u26D4\u26E9-\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733-\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763-\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934-\u2935\u2B05-\u2B07\u2B1B-\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|(?:\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67)\uDB40\uDC7F))/g;

    let convertedCount = 0;
    const result = html.replace(emojiRegex, (match) => {
      try {
        // 将 emoji 转换为 Unicode 码点
        const codePoint = this.getEmojiCodePoint(match);
        if (codePoint) {
          convertedCount++;
          // 简化处理，只转义基本字符，使用简单的 onerror fallback
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
        }
        return match;
      } catch (error) {
        this.logger.debug(`无法转换 emoji: ${match}`, error);
        return match;
      }
    });

    this.logger.info(`🖼️ 动态转换了${convertedCount}个 emoji 为 CDN 图片`);

    return result;
  }

  /**
   * 获取 emoji 的 Unicode 码点
   */
  private getEmojiCodePoint(emoji: string): string | null {
    try {
      const codePoints = [];
      let i = 0;

      while (i < emoji.length) {
        const code = emoji.codePointAt(i);
        if (code) {
          // 过滤掉变体选择器（U+FE0F）和其他修饰符
          if (code !== 0xfe0f && code !== 0x200d) {
            codePoints.push(code.toString(16));
          }

          // 如果是代理对，跳过下一个字符
          if (code > 0xffff) {
            i += 2;
          } else {
            i += 1;
          }
        } else {
          i += 1;
        }
      }

      // 对于某些特殊 emoji，可能需要特殊处理
      let result = codePoints.join('-');

      // 处理一些特殊情况，如带有肤色修饰符的 emoji
      if (
        result.includes('1f3fb') ||
        result.includes('1f3fc') ||
        result.includes('1f3fd') ||
        result.includes('1f3fe') ||
        result.includes('1f3ff')
      ) {
        // 对于带有肤色修饰符的 emoji，保留第一个码点
        result = codePoints[0];
      }

      return result.length > 0 ? result : null;
    } catch (error) {
      this.logger.debug(`获取 emoji 码点失败：${emoji}`, error);
      return null;
    }
  }

  /**
   * 将 markdown 内容转换为图片
   */
  async convertToImage(markdownContent: string): Promise<Buffer> {
    const startTime = Date.now();

    // 等待渲染槽位，避免并发渲染影响性能
    await this.waitForRenderSlot();

    this.logger.info('开始图片渲染，队列等待时间：', Date.now() - startTime, 'ms');

    // 获取 puppeteer 服务
    const puppeteer = (this.ctx as any).puppeteer;

    // 获取 GitHub markdown CSS
    const githubCssPath = require.resolve('github-markdown-css/github-markdown.css');
    const githubCss = readFileSync(githubCssPath, 'utf-8');

    // 生成字体 CSS
    const fontCss = this.generateFontCSS();

    // 将 markdown 转换为 HTML 并处理 emoji
    const htmlContent = this.markdownToHtml(markdownContent);
    const htmlWithEmoji = this.convertEmojiToImages(htmlContent);

    // 创建 HTML 模板
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          ${fontCss}
          ${githubCss}

          body {
            background-color: #f6f8fa;
            font-family: Maple Mono NF CN, "Segoe UI", sans-serif;
            margin: 20px;
          }

          .markdown-body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 1000px;
            margin: 0 auto;
            padding: 45px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            font-family: Maple Mono NF CN, "Segoe UI", sans-serif;
            line-height: 1.6;
          }

          /* 代码块使用等宽字体 */
          /* .markdown-body pre, .markdown-body code {
            font-family: 'Consolas', 'Monaco', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace;
          } */

          h1 {
            color: #1f2328;
            border-bottom: 1px solid #d1d9e0;
            padding-bottom: 10px;
            font-weight: bold;
          }
          h2 {
            color: #1f2328;
            border-bottom: 1px solid #d1d9e0;
            padding-bottom: 8px;
            font-weight: bold;
          }
          h3 {
            color: #1f2328;
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: bold;
          }
          h4 {
            color: #1f2328;
            margin-top: 20px;
            margin-bottom: 12px;
            font-size: 1.1em;
            font-weight: bold;
          }

          /* 粗体文本确保使用粗体字体 */
          .markdown-body strong, .markdown-body b {
            font-weight: bold;
          }

          .ai-summary-title {
            font-size: 28px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 30px;
            color: #667eea;
          }

          /* 确保中文标点符号正确显示 */
          .markdown-body {
            text-rendering: optimizeLegibility;
            -webkit-font-feature-settings: "liga", "kern";
            font-feature-settings: "liga", "kern";
          }
        </style>
      </head>
      <body>
        <div class="markdown-body">
          <div class="ai-summary-title"><img class="emoji" src="https://cdn.bootcdn.net/ajax/libs/twemoji/16.0.1/72x72/1f916.png" alt="🤖" loading="eager"> AI 总结</div>
          ${htmlWithEmoji}
        </div>
      </body>
      </html>
    `;

    try {
      // 使用 Koishi 的 puppeteer 服务渲染页面
      const imageBuffer = await puppeteer.render(html, async (page, next) => {
        // 设置视口
        await page.setViewport({
          width: 1200,
          height: 1000,
          deviceScaleFactor: 2,
        });

        // 等待页面加载完成
        await page.waitForSelector('.markdown-body');

        // 等待字体和 emoji 图片加载完成
        this.logger.info('等待字体和 emoji 图片加载完成...');

        await page.evaluate(() => {
          return new Promise((resolve) => {
            // 等待字体加载
            if (document.fonts && document.fonts.ready) {
              document.fonts.ready.then(() => {
                console.log('字体加载完成');
              });
            }

            const emojiImages = document.querySelectorAll('img.emoji');
            let loadedCount = 0;
            const totalImages = emojiImages.length;

            if (totalImages === 0) {
              console.log('没有找到 emoji 图片');
              resolve(undefined);
              return;
            }

            console.log(`找到${totalImages}个 emoji 图片，开始加载`);

            const checkAllLoaded = () => {
              loadedCount++;
              console.log(`emoji 图片加载进度：${loadedCount}/${totalImages}`);

              if (loadedCount >= totalImages) {
                console.log('✅ 所有 emoji 图片加载完成');
                resolve(undefined);
              }
            };

            emojiImages.forEach((img) => {
              const image = img as HTMLImageElement;
              if (image.complete) {
                checkAllLoaded();
              } else {
                image.onload = checkAllLoaded;
                image.onerror = () => {
                  console.log(`⚠️ emoji 图片加载失败：${image.src}`);
                  checkAllLoaded();
                };
              }
            });

            // 设置超时，避免无限等待
            setTimeout(() => {
              if (loadedCount < totalImages) {
                console.log(`⏰ emoji图片加载超时，已加载${loadedCount}/${totalImages}`);
              }
              resolve(undefined);
            }, 5000);
          });
        });

        this.logger.info('资源加载完成');

        // 额外等待确保渲染完成
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 获取内容区域并截图
        const element = await page.$('.markdown-body');
        if (!element) {
          throw new Error('无法找到内容区域');
        }

        const boundingBox = await element.boundingBox();
        if (!boundingBox) {
          throw new Error('无法获取内容区域尺寸');
        }

        const screenshot = await page.screenshot({
          type: 'png',
          optimizeForSpeed: false,
          clip: {
            x: Math.max(0, boundingBox.x - 20),
            y: Math.max(0, boundingBox.y - 20),
            width: boundingBox.width + 40,
            height: boundingBox.height + 40,
          },
        });

        return screenshot;
      });

      const totalTime = Date.now() - startTime;
      this.logger.info('Markdown 转图片成功', {
        contentLength: markdownContent.length,
        imageSize: imageBuffer.length,
        renderTime: totalTime + 'ms',
      });

      return Buffer.from(imageBuffer, 'base64');
    } catch (error) {
      this.logger.error('Markdown 转图片失败', error);
      throw error;
    } finally {
      // 释放渲染槽位，允许其他渲染任务继续
      this.releaseRenderSlot();
    }
  }

  /**
   * 简单的 markdown 到 HTML 转换
   */
  private markdownToHtml(markdown: string): string {
    const result = markdown
      // 标题
      .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')

      // 粗体和斜体
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')

      // 代码块
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```/g, '').trim();
        return `<pre><code>${code}</code></pre>`;
      })

      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')

      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

      // 列表
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')

      // 数字列表
      .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>')

      // 换行
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')

      // 包装段落
      .replace(/^(.+)$/gm, '<p>$1</p>')

      // 清理空段落
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<[^>]+>)<\/p>/g, '$1');

    return result;
  }
}
