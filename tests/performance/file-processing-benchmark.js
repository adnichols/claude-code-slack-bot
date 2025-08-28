/**
 * Performance benchmark for file processing improvements
 * Tests streaming vs non-streaming performance
 */

const fs = require('fs');
const path = require('path');
const { FileContentFormatter } = require('../../dist/file-content-formatter');

// Create test fixtures
const testDir = path.join(__dirname, '../fixtures/performance');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Create test files of different sizes
const createTestFile = (name, sizeKB) => {
  const filePath = path.join(testDir, name);
  const content = 'A'.repeat(sizeKB * 1024); // 1KB = 1024 bytes
  fs.writeFileSync(filePath, content);
  return filePath;
};

const benchmark = async () => {
  console.log('🏃 Starting File Processing Performance Benchmark\n');
  
  const formatter = new FileContentFormatter();
  
  // Test files
  const tests = [
    { name: 'small-1kb.txt', size: 1 },
    { name: 'medium-100kb.txt', size: 100 },
    { name: 'large-1mb.txt', size: 1024 },
    { name: 'extra-large-10mb.txt', size: 10240 }
  ];
  
  const results = [];
  
  for (const test of tests) {
    console.log(`📝 Testing ${test.name} (${test.size}KB)`);
    
    const filePath = createTestFile(test.name, test.size);
    const file = {
      name: test.name,
      mimetype: 'text/plain',
      path: filePath,
      isImage: false,
      isText: true,
      size: test.size * 1024
    };
    
    // Test with streaming enabled
    const startTimeStream = process.hrtime();
    const memStartStream = process.memoryUsage();
    
    try {
      await formatter.formatFilePrompt([file], 'Test streaming', { enableStreaming: true });
      
      const [seconds, nanoseconds] = process.hrtime(startTimeStream);
      const memEndStream = process.memoryUsage();
      
      const timeStream = seconds * 1000 + nanoseconds / 1000000; // Convert to milliseconds
      const memoryStream = memEndStream.heapUsed - memStartStream.heapUsed;
      
      // Test with streaming disabled for comparison (if file is small enough)
      let timeNoStream = null;
      let memoryNoStream = null;
      
      if (test.size <= 1024) { // Only test non-streaming for files <= 1MB
        const startTimeNoStream = process.hrtime();
        const memStartNoStream = process.memoryUsage();
        
        await formatter.formatFilePrompt([file], 'Test no streaming', { enableStreaming: false });
        
        const [secondsNo, nanosecondsNo] = process.hrtime(startTimeNoStream);
        const memEndNoStream = process.memoryUsage();
        
        timeNoStream = secondsNo * 1000 + nanosecondsNo / 1000000;
        memoryNoStream = memEndNoStream.heapUsed - memStartNoStream.heapUsed;
      }
      
      const result = {
        file: test.name,
        size: test.size,
        streamTime: timeStream,
        streamMemory: memoryStream,
        noStreamTime: timeNoStream,
        noStreamMemory: memoryNoStream
      };
      
      results.push(result);
      
      console.log(`  ⏱️  Streaming: ${timeStream.toFixed(2)}ms, Memory: ${(memoryStream / 1024).toFixed(2)}KB`);
      if (timeNoStream) {
        console.log(`  ⏱️  No Stream: ${timeNoStream.toFixed(2)}ms, Memory: ${(memoryNoStream / 1024).toFixed(2)}KB`);
        console.log(`  📈 Performance: ${((timeNoStream - timeStream) / timeNoStream * 100).toFixed(1)}% time improvement`);
      }
      console.log('');
      
    } catch (error) {
      console.error(`  ❌ Error processing ${test.name}:`, error.message);
    }
    
    // Cleanup
    fs.unlinkSync(filePath);
  }
  
  // Summary
  console.log('📊 Performance Summary:');
  console.log('======================');
  
  const targets = {
    responseTime: 2000, // 2s target
    memoryUsage: 50 * 1024 * 1024 // 50MB target
  };
  
  let allTargetsMet = true;
  
  for (const result of results) {
    const targetMet = result.streamTime < targets.responseTime;
    allTargetsMet = allTargetsMet && targetMet;
    
    console.log(`${result.file}: ${result.streamTime.toFixed(2)}ms ${targetMet ? '✅' : '❌'}`);
  }
  
  console.log(`\n🎯 Overall Performance: ${allTargetsMet ? '✅ All targets met' : '❌ Some targets missed'}`);
  
  // Cleanup test directory
  fs.rmSync(testDir, { recursive: true, force: true });
  
  return allTargetsMet;
};

// Run benchmark if called directly
if (require.main === module) {
  benchmark().catch(console.error);
}

module.exports = { benchmark };