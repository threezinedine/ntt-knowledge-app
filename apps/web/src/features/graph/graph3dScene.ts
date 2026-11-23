import { Group, Mesh, MeshLambertMaterial, SphereGeometry, type Object3D } from 'three';
import SpriteText from 'three-spritetext';
import { endId, type Link3D, type Node3D } from './graph3dData';

// Same palette as the 2D canvas (see --graph-* in styles.css).
export const BG = '#1e1e22';
const LINE = '#4a4a52';
const LABEL = '#b9b9c0';
const ACCENT = '#8b6cf6';
const DIM_OPACITY = 0.12;

/** Engine-owned arrow mesh on a link (three-forcegraph's bind attribute). */
interface LinkMeshes {
  __arrowObj?: Object3D;
}

/** The arrow's mesh (the engine may wrap it in a group) and its own material. */
function arrowMaterial(link: LinkMeshes): MeshLambertMaterial | null {
  const obj = link.__arrowObj;
  const mesh = obj?.children[0] ?? obj;
  const mat = (mesh as { material?: unknown } | undefined)?.material;
  return mat instanceof MeshLambertMaterial ? mat : null;
}

const lambert = (color: string, opacity: number) =>
  new MeshLambertMaterial({ color, transparent: true, opacity });

/**
 * Builds the 3D objects once and restyles them in place on hover.
 *
 * Why: three-forcegraph recreates *every* object whenever an accessor prop
 * (`nodeThreeObject`, `nodeColor`, `linkColor`, …) changes identity. Highlighting
 * through props would rebuild the scene and re-upload a texture per label on
 * each mouse-over. Here the accessors passed to it stay stable and a hover
 * only changes colours and opacities of materials in place. Each link line
 * gets its own material through `linkMaterial` (the engine assigns it and
 * leaves it alone); arrows already have one each.
 */
export class SceneStyler {
  private readonly nodes = new Map<string, { sphere: MeshLambertMaterial; label: SpriteText }>();
  private readonly linkLabels = new Map<string, SpriteText>();
  private readonly links = new Map<string, Link3D & LinkMeshes>();
  private readonly lineMats = new Map<string, MeshLambertMaterial>();
  private hovered: string | null = null;
  private neighbours: ReadonlyMap<string, ReadonlySet<string>> = new Map();

  /** For `nodeThreeObject` (with `nodeThreeObjectExtend` off: we draw the sphere). */
  readonly nodeObject = (node: Node3D) => {
    const sphere = lambert(node.color, 0.95);
    const mesh = new Mesh(new SphereGeometry(node.radius, 20, 14), sphere);
    const label = new SpriteText(node.title, 5, LABEL);
    label.fontFace = 'system-ui, sans-serif';
    label.position.y = -(node.radius + 5);
    const group = new Group();
    group.add(mesh, label);
    this.nodes.set(node.id, { sphere, label });
    this.styleNode(node.id);
    return group;
  };

  /** For `linkMaterial`: one material per link, restyled in place. */
  readonly linkMaterial = (link: Link3D) => {
    let mat = this.lineMats.get(link.id);
    if (!mat) {
      mat = lambert(LINE, 0.8);
      this.lineMats.set(link.id, mat);
    }
    return mat;
  };

  /** For `linkThreeObject` (extended: the engine still draws line and arrow). */
  readonly linkObject = (link: Link3D) => {
    const label = new SpriteText(link.name, 3, LABEL);
    label.fontFace = 'ui-monospace, Consolas, monospace';
    label.material.depthWrite = false; // stays readable where it crosses a sphere
    this.linkLabels.set(link.id, label);
    this.links.set(link.id, link);
    return label;
  };

  /** Forget objects of nodes/links that are gone (the engine disposes them). */
  prune(nodeIds: ReadonlySet<string>, linkIds: ReadonlySet<string>) {
    for (const id of this.nodes.keys()) if (!nodeIds.has(id)) this.nodes.delete(id);
    for (const id of this.links.keys()) {
      if (linkIds.has(id)) continue;
      this.links.delete(id);
      this.linkLabels.delete(id);
      this.lineMats.get(id)?.dispose();
      this.lineMats.delete(id);
    }
  }

  setNeighbours(neighbours: ReadonlyMap<string, ReadonlySet<string>>) {
    this.neighbours = neighbours;
  }

  /** Hover changed: restyle in place, no objects created. */
  highlight(hovered: string | null) {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    for (const id of this.nodes.keys()) this.styleNode(id);
    for (const id of this.links.keys()) this.styleLink(id);
  }

  /** Call after the engine (re)built its line meshes, e.g. on a data change. */
  restyleLinks() {
    for (const id of this.links.keys()) this.styleLink(id);
  }

  private lit(id: string) {
    const h = this.hovered;
    return h === null || id === h || (this.neighbours.get(h)?.has(id) ?? false);
  }

  private styleNode(id: string) {
    const objs = this.nodes.get(id);
    if (!objs) return;
    const on = this.lit(id);
    objs.sphere.opacity = on ? 0.95 : DIM_OPACITY;
    objs.label.material.opacity = on ? 1 : DIM_OPACITY;
  }

  private styleLink(id: string) {
    const link = this.links.get(id);
    if (!link) return;
    const h = this.hovered;
    const state =
      h === null
        ? 'normal'
        : endId(link.source) === h || endId(link.target) === h
          ? 'active'
          : 'dim';
    const color = state === 'active' ? ACCENT : LINE;
    const opacity = state === 'dim' ? DIM_OPACITY : state === 'active' ? 1 : 0.8;
    for (const mat of [this.lineMats.get(id), arrowMaterial(link)]) {
      if (!mat) continue;
      mat.color.set(color);
      mat.opacity = opacity;
    }
    const label = this.linkLabels.get(id);
    if (label) label.material.opacity = state === 'dim' ? DIM_OPACITY : 1;
  }
}
