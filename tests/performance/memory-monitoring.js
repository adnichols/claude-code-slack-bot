/**
 * Memory monitoring and leak detection for file processing
 */

const fs = require('fs');
const path = require('path');
const { FileContentFormatter } = require('../../dist/file-content-formatter');

const monitorMemory = async () => {
  console.log('🧠 Memory Monitoring and Leak Detection\n');
  
  const formatter = new FileContentFormatter();
  
  // Baseline memory measurement
  if (global.gc) {
    global.gc(); // Force garbage collection if available
  }
  
  const baselineMemory = process.memoryUsage();
  console.log('📊 Baseline Memory Usage:');
  console.log(`  RSS: ${(baselineMemory.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Used: ${(baselineMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Total: ${(baselineMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  External: ${(baselineMemory.external / 1024 / 1024).toFixed(2)} MB\n`);
  
  // Create test fixtures directory
  const testDir = path.join(__dirname, '../fixtures/memory-test');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Test repeated operations to check for memory leaks
  const iterations = 10;
  const memoryReadings = [];
  
  console.log(`🔄 Running ${iterations} iterations of file processing...\n`);
  
  for (let i = 0; i < iterations; i++) {
    // Create a test file for each iteration
    const fileName = `test-${i}.txt`;
    const filePath = path.join(testDir, fileName);
    const content = 'Lorem ipsum '.repeat(10000); // ~110KB file
    fs.writeFileSync(filePath, content);
    
    const file = {
      name: fileName,
      mimetype: 'text/plain',
      path: filePath,
      isImage: false,
      isText: true,
      size: content.length
    };
    
    // Process file
    await formatter.formatFilePrompt([file], 'Memory test');
    
    // Clean up file immediately
    fs.unlinkSync(filePath);
    
    // Call dispose method
    formatter.dispose();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Record memory usage
    const currentMemory = process.memoryUsage();
    memoryReadings.push({
      iteration: i + 1,
      rss: currentMemory.rss,
      heapUsed: currentMemory.heapUsed,
      heapTotal: currentMemory.heapTotal,
      external: currentMemory.external
    });
    
    if ((i + 1) % 3 === 0) {
      console.log(`  Iteration ${i + 1}: Heap ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  
  // Analyze memory trends
  console.log('\n📈 Memory Analysis:');
  console.log('==================');
  
  const firstReading = memoryReadings[0];
  const lastReading = memoryReadings[memoryReadings.length - 1];
  
  const heapGrowth = (lastReading.heapUsed - firstReading.heapUsed) / 1024 / 1024;
  const rssGrowth = (lastReading.rss - firstReading.rss) / 1024 / 1024;
  
  console.log(`Heap Growth: ${heapGrowth.toFixed(2)} MB`);
  console.log(`RSS Growth: ${rssGrowth.toFixed(2)} MB`);
  
  // Check for memory leaks (growth should be minimal)
  const heapLeakThreshold = 5; // MB
  const rssLeakThreshold = 10; // MB
  
  const heapLeakDetected = heapGrowth > heapLeakThreshold;
  const rssLeakDetected = rssGrowth > rssLeakThreshold;
  
  console.log(`\n🔍 Leak Detection:`);
  console.log(`  Heap Leak: ${heapLeakDetected ? '❌ Detected' : '✅ None'} (${heapGrowth.toFixed(2)} MB growth, threshold: ${heapLeakThreshold} MB)`);
  console.log(`  RSS Leak: ${rssLeakDetected ? '❌ Detected' : '✅ None'} (${rssGrowth.toFixed(2)} MB growth, threshold: ${rssLeakThreshold} MB)`);
  
  // Memory stability check
  const heapReadings = memoryReadings.map(r => r.heapUsed);
  const avgHeap = heapReadings.reduce((a, b) => a + b, 0) / heapReadings.length;
  const maxHeap = Math.max(...heapReadings);
  const minHeap = Math.min(...heapReadings);
  const heapVariation = ((maxHeap - minHeap) / avgHeap) * 100;
  
  console.log(`\n📊 Memory Stability:`);
  console.log(`  Average Heap: ${(avgHeap / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Max Heap: ${(maxHeap / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Min Heap: ${(minHeap / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Variation: ${heapVariation.toFixed(1)}%`);
  
  const stableMemory = heapVariation < 20; // Less than 20% variation is considered stable
  console.log(`  Stability: ${stableMemory ? '✅ Stable' : '⚠️ Unstable'}`);
  
  // Final memory check
  if (global.gc) {
    global.gc();
  }
  
  const finalMemory = process.memoryUsage();
  const finalGrowth = (finalMemory.heapUsed - baselineMemory.heapUsed) / 1024 / 1024;
  
  console.log(`\n🏁 Final Results:`);
  console.log(`  Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Net Growth: ${finalGrowth.toFixed(2)} MB`);
  
  // Overall assessment
  const memoryEfficient = !heapLeakDetected && !rssLeakDetected && stableMemory && finalGrowth < 2;
  
  console.log(`\n🎯 Overall Memory Performance: ${memoryEfficient ? '✅ Excellent' : '⚠️ Needs Attention'}`);
  
  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
  
  return {
    memoryEfficient,
    heapLeakDetected,
    rssLeakDetected,
    stableMemory,
    finalGrowth,
    heapVariation
  };
};

// Run monitoring if called directly
if (require.main === module) {
  monitorMemory().catch(console.error);
}

module.exports = { monitorMemory };