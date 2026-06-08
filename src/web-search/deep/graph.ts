import type {
  CodexProviderDeepSearchPlan,
  CodexProviderDeepSearchPlanNode,
} from './planner.js';

export interface CodexProviderDeepSearchGraph {
  query: string;
  nodes: CodexProviderDeepSearchPlanNode[];
  levels: CodexProviderDeepSearchPlanNode[][];
}

export function createCodexProviderDeepSearchGraph(
  plan: CodexProviderDeepSearchPlan,
): CodexProviderDeepSearchGraph {
  const nodes = plan.nodes.map((node) => ({
    ...node,
    dependsOn: [...node.dependsOn],
  }));
  assertValidDeepSearchGraph(nodes);
  return {
    query: plan.query,
    nodes,
    levels: topologicalDeepSearchNodeLevels(nodes),
  };
}

export function topologicalDeepSearchNodeLevels(
  nodes: CodexProviderDeepSearchPlanNode[],
): CodexProviderDeepSearchPlanNode[][] {
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const levels: CodexProviderDeepSearchPlanNode[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ready.length === 0) {
      throw new Error('Deep search graph contains a dependency cycle.');
    }
    levels.push(ready);
    for (const node of ready) {
      remaining.delete(node.id);
      completed.add(node.id);
    }
  }
  return levels;
}

function assertValidDeepSearchGraph(nodes: CodexProviderDeepSearchPlanNode[]): void {
  if (nodes.length === 0) {
    throw new Error('Deep search graph requires at least one node.');
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    const id = normalizeString(node.id);
    if (!id) {
      throw new Error('Deep search graph node requires a non-empty id.');
    }
    if (ids.has(id)) {
      throw new Error(`Deep search graph contains duplicate node id: ${id}`);
    }
    ids.add(id);
    if (node.type !== 'root' && node.type !== 'search') {
      throw new Error(`Deep search graph node ${id} has unsupported type: ${String(node.type)}`);
    }
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`Deep search graph node ${node.id} depends on unknown node: ${dependency}`);
      }
    }
  }
  topologicalDeepSearchNodeLevels(nodes);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
