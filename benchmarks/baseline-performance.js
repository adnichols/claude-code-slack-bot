#!/usr/bin/env node

/**
 * Performance Baseline Measurement Script
 * Establishes current performance characteristics before simplification
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

class PerformanceBaseline {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      version: 'pre-simplification',
      measurements: {}
    };
  }

  async measureFileOperations() {
    console.log('📁 Measuring file operation performance...');
    
    // Simulate different file sizes
    const testSizes = [
      { size: '1KB', bytes: 1024 },
      { size: '100KB', bytes: 100 * 1024 },
      { size: '1MB', bytes: 1024 * 1024 },
      { size: '10MB', bytes: 10 * 1024 * 1024 }
    ];

    const fileResults = {};

    for (const testSize of testSizes) {
      // Create test file
      const testFile = path.join(__dirname, `test-${testSize.size}.txt`);
      const content = 'x'.repeat(testSize.bytes);
      
      // Measure file write
      const writeStart = performance.now();
      fs.writeFileSync(testFile, content);
      const writeEnd = performance.now();
      
      // Measure file read  
      const readStart = performance.now();
      const readContent = fs.readFileSync(testFile, 'utf8');
      const readEnd = performance.now();
      
      // Measure file stats
      const statStart = performance.now();
      const stats = fs.statSync(testFile);
      const statEnd = performance.now();
      
      // Clean up
      fs.unlinkSync(testFile);
      
      fileResults[testSize.size] = {
        writeTime: writeEnd - writeStart,
        readTime: readEnd - readStart,
        statTime: statEnd - statStart,
        size: stats.size,
        readThroughput: stats.size / (readEnd - readStart) * 1000 // bytes/second
      };
    }
    
    this.results.measurements.fileOperations = fileResults;
  }

  async measureMemoryUsage() {
    console.log('💾 Measuring memory usage...');
    
    const memoryResults = {};
    
    // Baseline memory
    const baseline = process.memoryUsage();
    memoryResults.baseline = {
      rss: baseline.rss,
      heapUsed: baseline.heapUsed,
      heapTotal: baseline.heapTotal,
      external: baseline.external
    };
    
    // Memory with large string operations (simulates file content processing)
    const largeContent = 'x'.repeat(35 * 1024); // 35KB (Slack limit)
    const memAfterLarge = process.memoryUsage();
    
    memoryResults.with35KBString = {
      rss: memAfterLarge.rss,
      heapUsed: memAfterLarge.heapUsed,
      heapTotal: memAfterLarge.heapTotal,
      external: memAfterLarge.external,
      rssDelta: memAfterLarge.rss - baseline.rss,
      heapDelta: memAfterLarge.heapUsed - baseline.heapUsed
    };
    
    this.results.measurements.memory = memoryResults;
  }

  async measureStringOperations() {
    console.log('📝 Measuring string operations (file content processing)...');
    
    const testContent = 'Line 1: Sample content\\n'.repeat(1000); // ~20KB
    
    // Line number stripping (current implementation simulation)
    const stripStart = performance.now();
    const lines = testContent.split('\\n');
    const strippedLines = lines.map(line => {
      // Simulate the line number prefix removal
      if (line.match(/^\\s*\\d+→/)) {
        return line.replace(/^\\s*\\d+→/, '');
      }
      return line;
    });
    const strippedContent = strippedLines.join('\\n');
    const stripEnd = performance.now();
    
    // Content truncation
    const truncateStart = performance.now();
    const truncatedContent = testContent.length > 35000 
      ? testContent.substring(0, 35000) + '\\n... (truncated)'
      : testContent;
    const truncateEnd = performance.now();
    
    // JSON stringification (logging overhead)
    const jsonStart = performance.now();
    const jsonString = JSON.stringify({ content: testContent });
    const jsonEnd = performance.now();
    
    const stringResults = {
      lineStripping: {
        time: stripEnd - stripStart,
        inputSize: testContent.length,
        outputSize: strippedContent.length,
        linesProcessed: lines.length
      },
      truncation: {
        time: truncateEnd - truncateStart,
        inputSize: testContent.length,
        outputSize: truncatedContent.length,
        wasTruncated: testContent.length > 35000
      },
      jsonStringify: {
        time: jsonEnd - jsonStart,
        inputSize: testContent.length,
        outputSize: jsonString.length
      }
    };
    
    this.results.measurements.stringOperations = stringResults;
  }

  async measureConcurrencyLimits() {
    console.log('⚡ Measuring concurrency characteristics...');
    
    const concurrencyResults = {};
    
    // Simulate concurrent file operations
    const concurrentCount = 10;
    const concurrentStart = performance.now();
    
    const promises = Array.from({ length: concurrentCount }, async (_, i) => {
      const testFile = path.join(__dirname, `concurrent-test-${i}.txt`);
      const content = 'x'.repeat(1024 * 100); // 100KB each
      
      return new Promise((resolve) => {
        setTimeout(() => {
          fs.writeFileSync(testFile, content);
          const readContent = fs.readFileSync(testFile, 'utf8');
          fs.unlinkSync(testFile);
          resolve(readContent.length);
        }, Math.random() * 10); // Random delay 0-10ms
      });
    });
    
    const results = await Promise.all(promises);
    const concurrentEnd = performance.now();
    
    concurrencyResults.concurrentFileOps = {
      operationCount: concurrentCount,
      totalTime: concurrentEnd - concurrentStart,
      avgTimePerOp: (concurrentEnd - concurrentStart) / concurrentCount,
      successCount: results.length,
      totalBytesProcessed: results.reduce((sum, size) => sum + size, 0)
    };
    
    this.results.measurements.concurrency = concurrencyResults;
  }

  async measureModuleLoadTimes() {
    console.log('📦 Measuring module load performance...');
    
    const moduleResults = {};
    
    // Measure require times for key modules
    const testModules = [
      { name: '@slack/bolt', path: '@slack/bolt' },
      { name: 'typescript-dist', path: '../dist/slack-handler.js' }
    ];
    
    for (const module of testModules) {
      try {
        const loadStart = performance.now();
        delete require.cache[require.resolve(module.path)];
        require(module.path);
        const loadEnd = performance.now();
        
        moduleResults[module.name] = {
          loadTime: loadEnd - loadStart,
          success: true
        };
      } catch (error) {
        moduleResults[module.name] = {
          loadTime: null,
          success: false,
          error: error.message
        };
      }
    }
    
    this.results.measurements.moduleLoading = moduleResults;
  }

  generateReport() {
    console.log('\\n📊 Performance Baseline Report');
    console.log('================================');
    
    const { measurements } = this.results;
    
    if (measurements.fileOperations) {
      console.log('\\n📁 File Operations:');
      Object.entries(measurements.fileOperations).forEach(([size, data]) => {
        console.log(`  ${size}: Read ${data.readTime.toFixed(2)}ms, Write ${data.writeTime.toFixed(2)}ms`);
        console.log(`    Throughput: ${(data.readThroughput / 1024 / 1024).toFixed(2)} MB/s`);
      });
    }
    
    if (measurements.memory) {
      console.log('\\n💾 Memory Usage:');
      console.log(`  Baseline RSS: ${(measurements.memory.baseline.rss / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Baseline Heap: ${(measurements.memory.baseline.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  35KB String Impact: +${(measurements.memory.with35KBString.heapDelta / 1024).toFixed(2)} KB`);
    }
    
    if (measurements.stringOperations) {
      console.log('\\n📝 String Operations:');
      console.log(`  Line Stripping: ${measurements.stringOperations.lineStripping.time.toFixed(2)}ms`);
      console.log(`  Content Truncation: ${measurements.stringOperations.truncation.time.toFixed(2)}ms`);
      console.log(`  JSON Stringify: ${measurements.stringOperations.jsonStringify.time.toFixed(2)}ms`);
    }
    
    if (measurements.concurrency) {
      console.log('\\n⚡ Concurrency:');
      console.log(`  10 Concurrent Ops: ${measurements.concurrency.concurrentFileOps.totalTime.toFixed(2)}ms total`);
      console.log(`  Avg per Operation: ${measurements.concurrency.concurrentFileOps.avgTimePerOp.toFixed(2)}ms`);
    }
    
    // Define acceptable performance thresholds
    console.log('\\n🎯 Performance Thresholds (Targets for Simplification):');
    console.log('  Response Time: < 2000ms for all operations');
    console.log('  Memory Usage: < 50MB steady state');
    console.log('  File Processing: No blocking operations > 100ms');
    console.log('  String Operations: < 10ms for 35KB content');
  }

  async saveResults() {
    const resultsFile = path.join(__dirname, `baseline-results-${Date.now()}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2));
    console.log(`\\n💾 Results saved to: ${resultsFile}`);
    return resultsFile;
  }

  async run() {
    console.log('🚀 Starting Performance Baseline Measurement');
    console.log(`Node.js version: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    console.log(`Memory: ${(require('os').totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB total\\n`);
    
    await this.measureMemoryUsage();
    await this.measureFileOperations();
    await this.measureStringOperations(); 
    await this.measureConcurrencyLimits();
    await this.measureModuleLoadTimes();
    
    this.generateReport();
    await this.saveResults();
    
    console.log('\\n✅ Performance baseline established');
  }
}

// Run the benchmark if called directly
if (require.main === module) {
  const baseline = new PerformanceBaseline();
  baseline.run().catch(console.error);
}

module.exports = PerformanceBaseline;