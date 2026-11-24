import type { Edge, GraphNode, PhoneView } from '@km/core';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client';
import { edgesOf, hubFailure, listNodes } from './phoneData';

const node = (id: string, title: string, updatedAt: number, type = 'note'): GraphNode => ({
  id,
  title,
  type,
  content: '',
  props: {},
  position: null,
  tagIds: [],
  createdAt: 0,
  updatedAt,
});
const edge = (id: string, fromId: string, toId: string, name: string): Edge => ({
  id,
  fromId,
  toId,
  name,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

const nodes = [node('a', 'Alpha', 3), node('b', 'Beta', 1, 'person'), node('c', 'Gamma', 2)];
const view: PhoneView = {
  head: { version: 1, hash: 'h', createdAt: 0, deviceName: 'PC' },
  graph: {
    nodes: nodes.map(({ id, type, title, position }) => ({ id, type, title, position })),
    edges: [
      edge('e1', 'a', 'c', 'uses'),
      edge('e2', 'a', 'b', 'uses'),
      edge('e3', 'b', 'a', 'knows'),
      edge('e4', 'a', 'gone', 'dangles'),
    ],
  },
  nodes,
  tags: [],
  exp: { maxLevel: 1, tags: [] },
};

describe('the phone’s copy answers like the server', () => {
  it('lists nodes most recently edited first, filtered and limited', () => {
    expect(listNodes(view, new URLSearchParams()).map((n) => n.id)).toEqual(['a', 'c', 'b']);
    expect(listNodes(view, new URLSearchParams('q=ET')).map((n) => n.id)).toEqual(['b']);
    expect(listNodes(view, new URLSearchParams('type=person')).map((n) => n.id)).toEqual(['b']);
    expect(listNodes(view, new URLSearchParams('limit=1')).map((n) => n.id)).toEqual(['a']);
  });

  it('gives a node’s links by name, then the other end’s title, skipping missing ends', () => {
    const { outgoing, incoming } = edgesOf(view, 'a');
    expect(outgoing.map((e) => e.neighbor.title)).toEqual(['Beta', 'Gamma']);
    expect(incoming.map((e) => e.edge.id)).toEqual(['e3']);
  });
});

describe('hub failures on the phone', () => {
  const reason = (e: unknown) => hubFailure(e).body?.error.reason;

  it('are never a 401 (that would look like a sign-in ending)', () => {
    const denied = hubFailure(new ApiError(401, undefined));
    expect(denied.status).toBe(502);
    expect(denied.body?.error.reason).toBe('HUB_DENIED');
  });

  it('keep the hub’s reason, or say what went wrong', () => {
    expect(reason(new NetworkError(new Error('down')))).toBe('HUB_UNREACHABLE');
    const wrongCode = new ApiError(401, {
      error: { code: 'UNAUTHORIZED', reason: 'CODE_INVALID', message: '' },
    });
    expect(reason(wrongCode)).toBe('CODE_INVALID');
    expect(reason(new ApiError(404, undefined))).toBe('HUB_NOT_ENABLED');
    expect(reason(new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: '' } }))).toBe(
      'HUB_ERROR',
    );
  });
});
