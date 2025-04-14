// Используем legacy версию PDF.js для Node.js
// @ts-ignore - Legacy версия не имеет своих определений типов
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

/**
 * Извлечение текста из PDF файла с использованием PDF.js legacy версии
 * @param pdfData ArrayBuffer содержащий PDF данные
 * @returns Promise, возвращающий извлеченный текст
 */
export async function extractTextFromPDF(pdfData: ArrayBuffer): Promise<string> {
  try {
    console.log("Начало извлечения текста из PDF...");
    
    // Загружаем PDF документ с опциями для Node.js
    const loadingTask = pdfjsLib.getDocument({
      data: pdfData,
      // Отключаем ненужные возможности для Node.js
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      disableRange: true,
      nativeImageDecoderSupport: 'none',
      cMapUrl: undefined,
      standardFontDataUrl: undefined
    });
    
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    let text = '';

    // Извлекаем текст из каждой страницы
    for (let i = 1; i <= numPages; i++) {
      try {
        console.log(`Обработка страницы ${i}/${numPages}...`);
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str)
          .join(' ');
        text += pageText + '\n';
      } catch (pageError) {
        console.warn(`Ошибка при извлечении текста со страницы ${i}:`, pageError);
        // Продолжаем со следующей страницей
      }
    }

    console.log("Извлечение текста из PDF успешно завершено");
    return text;
  } catch (error: unknown) {
    console.error('Ошибка при обработке PDF:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error('Не удалось обработать PDF файл: ' + errorMessage);
  }
} 