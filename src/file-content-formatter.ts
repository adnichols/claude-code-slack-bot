import * as fs from 'fs';
import * as stream from 'stream';
import * as util from 'util';
import { Logger } from './logger.js';

const pipeline = util.promisify(stream.pipeline);

export interface FormattableFile {
  name: string;
  mimetype: string;
  path: string;
  isImage: boolean;
  isText: boolean;
  size: number;
}

export interface FileProcessingOptions {
  maxContentLength?: number;
  enableStreaming?: boolean;
  chunkSize?: number;
}

export class FileContentFormatter {
  private logger = new Logger('FileContentFormatter');
  private readonly MAX_CONTENT_LENGTH = 10000;
  private readonly STREAM_THRESHOLD = 50000; // Use streaming for files > 50KB
  private readonly CHUNK_SIZE = 8192; // 8KB chunks

  /**
   * Format files into a prompt string for Claude analysis
   */
  async formatFilePrompt(files: FormattableFile[], userText: string, options: FileProcessingOptions = {}): Promise<string> {
    let prompt = userText || 'Please analyze the uploaded files.';
    
    if (files.length === 0) {
      return prompt;
    }

    prompt += '\n\nUploaded files:\n';
    
    // Process files sequentially to avoid memory pressure
    for (const file of files) {
      try {
        if (file.isImage) {
          prompt += this.formatImageFile(file);
        } else if (file.isText) {
          prompt += await this.formatTextFile(file, options);
        } else {
          prompt += this.formatBinaryFile(file);
        }
      } catch (error) {
        // Only log if debug level is enabled to avoid performance overhead
        if (this.logger.isDebugEnabled()) {
          this.logger.warn('Error formatting file', { 
            fileName: file.name, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
        prompt += `\n## File: ${file.name}\nError: Could not process file\n`;
      }
    }
    
    prompt += '\nPlease analyze these files and provide insights or assistance based on their content.';
    return prompt;
  }

  private formatImageFile(file: FormattableFile): string {
    return `\n## Image: ${file.name}\n` +
           `File type: ${file.mimetype}\n` +
           `Path: ${file.path}\n` +
           `Note: This is an image file that has been uploaded. You can analyze it using the Read tool to examine the image content.\n`;
  }

  private async formatTextFile(file: FormattableFile, options: FileProcessingOptions = {}): Promise<string> {
    const maxLength = options.maxContentLength || this.MAX_CONTENT_LENGTH;
    const enableStreaming = options.enableStreaming !== false && file.size > this.STREAM_THRESHOLD;
    
    let content = `\n## File: ${file.name}\n` +
                 `File type: ${file.mimetype}\n`;
    
    try {
      let fileContent: string;
      
      if (enableStreaming) {
        fileContent = await this.readFileStreaming(file.path, maxLength);
      } else {
        // Use async file reading to avoid blocking
        fileContent = await fs.promises.readFile(file.path, 'utf-8');
      }
      
      const wasTruncated = fileContent.length > maxLength;
      const displayContent = wasTruncated 
        ? fileContent.substring(0, maxLength) 
        : fileContent;
      
      content += wasTruncated 
        ? `Content (truncated to first ${maxLength} characters):\n\`\`\`\n${displayContent}...\n\`\`\`\n`
        : `Content:\n\`\`\`\n${displayContent}\n\`\`\`\n`;
        
      // Clear reference for GC
      fileContent = undefined as any;
      
    } catch (error) {
      // Only log detailed error in debug mode
      if (this.logger.isDebugEnabled()) {
        this.logger.warn('Error reading text file content', { 
          path: file.path, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
      content += `Error reading file content: ${error instanceof Error ? error.message : String(error)}\n`;
    }

    return content;
  }

  /**
   * Read file content using streaming for large files to reduce memory usage
   */
  private async readFileStreaming(filePath: string, maxLength: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let content = '';
      let bytesRead = 0;
      
      const readStream = fs.createReadStream(filePath, { 
        encoding: 'utf8',
        highWaterMark: this.CHUNK_SIZE 
      });
      
      readStream.on('data', (chunk: Buffer | string) => {
        const chunkStr = chunk.toString('utf8');
        bytesRead += Buffer.byteLength(chunkStr, 'utf8');
        
        if (bytesRead > maxLength) {
          // Truncate chunk to reach exact maxLength
          const excess = bytesRead - maxLength;
          const chunkBytes = Buffer.byteLength(chunkStr, 'utf8');
          const keepBytes = chunkBytes - excess;
          
          if (keepBytes > 0) {
            // Convert back to string and keep only the needed portion
            const buffer = Buffer.from(chunkStr, 'utf8');
            const truncatedChunk = buffer.subarray(0, keepBytes).toString('utf8');
            content += truncatedChunk;
          }
          
          readStream.destroy(); // Stop reading
          resolve(content);
          return;
        }
        
        content += chunkStr;
      });
      
      readStream.on('end', () => resolve(content));
      readStream.on('error', reject);
    });
  }

  private formatBinaryFile(file: FormattableFile): string {
    return `\n## File: ${file.name}\n` +
           `File type: ${file.mimetype}\n` +
           `Size: ${file.size} bytes\n` +
           `Note: This is a binary file. Content analysis may be limited.\n`;
  }

  /**
   * Get max content length for text files
   */
  getMaxContentLength(): number {
    return this.MAX_CONTENT_LENGTH;
  }

  /**
   * Set max content length for text files
   */
  setMaxContentLength(length: number): void {
    if (length > 0) {
      // @ts-ignore - We want to modify the readonly property for testing
      this.MAX_CONTENT_LENGTH = length;
    }
  }

  /**
   * Dispose of resources and clear caches
   */
  dispose(): void {
    // Clear any cached data if we add caching in the future
    // Force garbage collection hints
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get recommended processing options based on file characteristics
   */
  getOptimalProcessingOptions(totalSize: number, fileCount: number): FileProcessingOptions {
    return {
      maxContentLength: totalSize > 1000000 ? 5000 : this.MAX_CONTENT_LENGTH, // Reduce for large batches
      enableStreaming: totalSize > this.STREAM_THRESHOLD * fileCount,
      chunkSize: this.CHUNK_SIZE
    };
  }
}