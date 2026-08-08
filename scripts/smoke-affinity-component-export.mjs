import assert from 'node:assert/strict';
import { AffinityService } from '../src/main/affinity-service.ts';

function partition(index, estimatedWork) {
  return {
    path: [0, index],
    parentPath: [0],
    parentName: 'Spread 1',
    parentType: 'Spread',
    parentHierarchyKey: '',
    hierarchyDepth: 0,
    mode: 'subtree',
    ancestorPaths: [],
    ...(estimatedWork ? { estimatedWork } : {}),
  };
}

function component(index) {
  return {
    index,
    name: `Component ${index + 1}`,
    affinityType: 'RasterNode',
    bounds: { x: index * 10, y: 0, width: 10, height: 10 },
    childCount: 0,
    descendantCount: 0,
    textCount: 0,
    semanticNames: [],
    path: `C:\\scan\\component-${index}.png`,
    hierarchyKey: `0.${index}`,
    parentHierarchyKey: '',
    hierarchyDepth: 0,
    members: [],
    grouping: 'single',
  };
}

function toolResult(batch) {
  return {
    content: [{ type: 'text', text: `KRYEO_COMPONENT_SCAN:${JSON.stringify(batch)}` }],
  };
}

function partitionChildrenResult(children) {
  return {
    content: [{ type: 'text', text: `KRYEO_COMPONENT_PARTITION_CHILDREN:${JSON.stringify({
      parentName: 'Dense group',
      parentType: 'GroupNode',
      count: children.length,
      children,
    })}` }],
  };
}

async function simulatedExport(totalPartitions, failFirstBatch = false, weights = []) {
  const service = new AffinityService();
  const ranges = [];
  let shouldFail = failFirstBatch;
  const harness = service;
  harness.connect = async () => undefined;
  harness.callTool = async (_name, args) => {
    const script = String(args.script || '');
    const start = Number(/const exportPartitionStart = (\d+);/.exec(script)?.[1] || 0);
    const end = Number(/const exportPartitionEnd = (\d+);/.exec(script)?.[1] || 0);
    if (end === 0) {
      return toolResult({
        documentTitle: 'Export fixture',
        documentSessionUuid: 'fixture-session',
        sourceName: 'Whole document',
        components: [],
        totalPartitions,
        partitionPlan: Array.from({ length: totalPartitions }, (_, index) => partition(index, weights[index])),
      });
    }
    ranges.push([start, end]);
    if (shouldFail) {
      shouldFail = false;
      throw new Error('MCP error -32001: Request timed out');
    }
    return toolResult({
      documentTitle: 'Export fixture',
      documentSessionUuid: 'fixture-session',
      sourceName: 'Whole document',
      components: Array.from({ length: end - start }, (_, offset) => component(start + offset)),
      totalPartitions,
    });
  };
  const result = await service.exportComponentCandidates('C:\\scan', 'document');
  return { result, ranges };
}

const batched = await simulatedExport(10);
assert.deepEqual(batched.ranges, [[0, 4], [4, 10]], 'quick batches should grow instead of reverting to one partition per call');
assert.equal(batched.result.components.length, 10);
assert.equal(batched.result.totalCandidates, 10);
assert.equal(batched.result.exportDiagnostics.requestCount, 3);
assert.equal(batched.result.exportDiagnostics.retryCount, 0);
assert.deepEqual(batched.result.components.map((item) => item.index), Array.from({ length: 10 }, (_, index) => index));

const recovered = await simulatedExport(6, true);
assert.deepEqual(recovered.ranges, [[0, 4], [0, 2], [2, 6]], 'a timed-out aggregate batch should retry the same range in smaller units');
assert.equal(recovered.result.components.length, 6);
assert.equal(recovered.result.totalCandidates, 6);
assert.equal(recovered.result.exportDiagnostics.requestCount, 4);
assert.equal(recovered.result.exportDiagnostics.retryCount, 1);
assert.deepEqual(recovered.result.components.map((item) => item.index), Array.from({ length: 6 }, (_, index) => index));

const weighted = await simulatedExport(6, false, [24, 1, 1, 1, 1, 1]);
assert.deepEqual(weighted.ranges, [[0, 1], [1, 6]], 'a dense partition must run alone while light partitions remain batched');
assert.equal(weighted.result.components.length, 6);

const adaptiveWeighted = await simulatedExport(10, false, Array.from({ length: 10 }, () => 8));
assert.deepEqual(
  adaptiveWeighted.ranges,
  [[0, 3], [3, 7], [7, 10]],
  'fast weighted batches should expand their work allowance instead of retaining the initial conservative cap',
);
assert.equal(adaptiveWeighted.result.components.length, 10);

const splitService = new AffinityService();
const splitRanges = [];
let shouldSplitOnePartition = true;
splitService.connect = async () => undefined;
splitService.callTool = async (_name, args) => {
  const script = String(args.script || '');
  if (script.includes('KRYEO_COMPONENT_PARTITION_CHILDREN:')) {
    assert.match(script, /function estimatedWork\(node\)/, 'the recovery script must define its child work estimator');
    return partitionChildrenResult([{ estimatedWork: 1 }, { estimatedWork: 1 }]);
  }
  const start = Number(/const exportPartitionStart = (\d+);/.exec(script)?.[1] || 0);
  const end = Number(/const exportPartitionEnd = (\d+);/.exec(script)?.[1] || 0);
  if (end === 0) {
    return toolResult({
      documentTitle: 'Export fixture',
      documentSessionUuid: 'fixture-session',
      sourceName: 'Whole document',
      components: [],
      totalPartitions: 1,
      partitionPlan: [partition(0, 24)],
    });
  }
  splitRanges.push([start, end]);
  if (shouldSplitOnePartition) {
    shouldSplitOnePartition = false;
    throw new Error('MCP error -32001: Request timed out');
  }
  return toolResult({
    documentTitle: 'Export fixture',
    documentSessionUuid: 'fixture-session',
    sourceName: 'Whole document',
    components: Array.from({ length: end - start }, (_, offset) => component(start + offset)),
    totalPartitions: 2,
  });
};
const split = await splitService.exportComponentCandidates('C:\\scan', 'document');
assert.deepEqual(splitRanges, [[0, 1], [0, 2]], 'a dense timed-out partition should split into weighted children and retry');
assert.equal(split.components.length, 2);
assert.equal(split.totalCandidates, 2);
assert.equal(split.exportDiagnostics.requestCount, 3);
assert.equal(split.exportDiagnostics.retryCount, 1);
assert.equal(split.exportDiagnostics.splitCount, 1);

const cancelledService = new AffinityService();
let cancelledConnected = false;
cancelledService.connect = async () => { cancelledConnected = true; };
const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(
  cancelledService.exportComponentCandidates('C:\\scan', 'document', undefined, cancelled.signal),
  /cancelled/i,
  'an already-cancelled scan should stop before opening an Affinity MCP connection',
);
assert.equal(cancelledConnected, false);

console.log(JSON.stringify({
  firstRunRanges: batched.ranges,
  timeoutRecoveryRanges: recovered.ranges,
  weightedRanges: weighted.ranges,
  adaptiveWeightedRanges: adaptiveWeighted.ranges,
  splitRecoveryRanges: splitRanges,
  cancellationStoppedBeforeConnect: !cancelledConnected,
  exportedComponents: recovered.result.components.length,
}, null, 2));
