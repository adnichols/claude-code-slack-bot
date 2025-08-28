// Using native fetch (Node.js 18+)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import { config } from './config';
import { FileContentFormatter } from './file-content-formatter';

export interface ProcessedFile {
  path: string;
  name: string;
  mimetype: string;
  isImage: boolean;
  isText: boolean;
  size: number;
  tempPath?: string;
}

export class FileHandler {
  private logger = new Logger('FileHandler');
  private formatter = new FileContentFormatter();

  async downloadAndProcessFiles(files: any[]): Promise<ProcessedFile[]> {
    const processedFiles: ProcessedFile[] = [];

    for (const file of files) {
      try {
        const processed = await this.downloadFile(file);
        if (processed) {
          processedFiles.push(processed);
        }
      } catch (error) {
        this.logger.error(`Failed to process file ${file.name}`, error);
      }
    }

    return processedFiles;
  }

  private async downloadFile(file: any): Promise<ProcessedFile | null> {
    // Check file size limit (50MB)
    if (file.size > 50 * 1024 * 1024) {
      this.logger.warn('File too large, skipping', { name: file.name, size: file.size });
      return null;
    }

    try {
      this.logger.debug('Downloading file', { name: file.name, mimetype: file.mimetype });

      const response = await fetch(file.url_private_download, {
        headers: {
          'Authorization': `Bearer ${config.slack.botToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `slack-file-${Date.now()}-${file.name}`);
      
      fs.writeFileSync(tempPath, buffer);

      const processed: ProcessedFile = {
        path: tempPath,
        name: file.name,
        mimetype: file.mimetype,
        isImage: this.isImageFile(file.mimetype),
        isText: this.isTextFile(file.mimetype),
        size: file.size,
        tempPath,
      };

      this.logger.info('File downloaded successfully', {
        name: file.name,
        tempPath,
        isImage: processed.isImage,
        isText: processed.isText,
      });

      return processed;
    } catch (error) {
      this.logger.error('Failed to download file', error);
      return null;
    }
  }

  private isImageFile(mimetype: string): boolean {
    return this.isImageSupported(mimetype);
  }

  /**
   * Enhanced image support checking with specific supported formats
   */
  private isImageSupported(mimetype: string): boolean {
    const supportedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/tiff'
    ];
    
    return supportedTypes.includes(mimetype.toLowerCase());
  }

  /**
   * Convert image to base64 data URL for embedding (if needed in future)
   */
  async convertImageToBase64(imagePath: string, mimetype: string): Promise<string | null> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      return `data:${mimetype};base64,${base64Image}`;
    } catch (error) {
      this.logger.error('Failed to convert image to base64', error);
      return null;
    }
  }

  private isTextFile(mimetype: string): boolean {
    const textTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
    ];

    return textTypes.some(type => mimetype.startsWith(type));
  }

  async formatFilePrompt(files: ProcessedFile[], userText: string): Promise<string> {
    return this.formatter.formatFilePrompt(files, userText);
  }

  async cleanupTempFiles(files: ProcessedFile[]): Promise<void> {
    for (const file of files) {
      if (file.tempPath) {
        try {
          fs.unlinkSync(file.tempPath);
          this.logger.debug('Cleaned up temp file', { path: file.tempPath });
        } catch (error) {
          this.logger.warn('Failed to cleanup temp file', { path: file.tempPath, error });
        }
      }
    }
  }

  getSupportedFileTypes(): string[] {
    return [
      'Images: jpg/jpeg, png, gif, webp, svg, bmp, tiff',
      'Text files: txt, md, json, js, ts, py, java, etc.',
      'Documents: pdf, docx (limited support)',
      'Code files: most programming languages',
    ];
  }
}