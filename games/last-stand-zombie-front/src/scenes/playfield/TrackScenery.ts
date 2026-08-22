import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
// Side-Effect-Import: ohne ihn kennt Mesh.createInstance() seine
// Implementierung nicht (Babylon-Tree-Shaking).
import '@babylonjs/core/Meshes/instancedMesh';
import type { Scene } from '@babylonjs/core/scene';
import { MOVEMENT, RENDER } from '../../config/gameBalance';
import { Random } from '../../util/Random';

const SEGMENT_LENGTH = 20;
/** Wie weit hinter dem Anker Geometrie stehen bleibt, bevor sie recycelt wird. */
const BEHIND_METERS = 40;
const ROAD_HALF_WIDTH = MOVEMENT.laneHalfWidth + 1.6;
/** Breite des Gelaendes neben der Strasse. */
const TERRAIN_HALF_WIDTH = 42;
/** Oberkante des Gelaendes — liegt unter dem Strassenniveau. */
const TERRAIN_TOP = -0.55;
const DEBRIS_SIZE = 1.4;

interface Segment {
  baseZ: number;
  terrain: InstancedMesh;
  road: InstancedMesh;
  barrierLeft: InstancedMesh;
  barrierRight: InstancedMesh;
  stripes: InstancedMesh[];
  debris: InstancedMesh[];
}

/**
 * Endlos scrollende Kulisse aus recycelter Geometrie.
 *
 * Statt eine lange Strasse zu bauen, existiert ein fester Ring aus Segmenten,
 * der vor dem Spieler wieder aufgebaut wird, sobald er hinten herausfaellt.
 * Damit ist der Speicherbedarf konstant, egal wie lange eine Runde dauert —
 * Voraussetzung fuer den Endlosmodus.
 *
 * Alle wiederholten Koerper sind Babylon-Instanzen eines einzigen Master-Mesh:
 * eine Geometrie, ein Material, ein Draw Call pro Typ (PLAN.md R1).
 */
export class TrackScenery {
  private readonly segments: Segment[] = [];
  private readonly masters: Mesh[] = [];
  /** Index des hintersten Segments im Ring. */
  private tail = 0;

  constructor(scene: Scene) {
    // Gelaende unter und neben der Strasse. Ohne das schweben Truemmer im
    // Nichts und die Fahrbahn verliert ihren raeumlichen Bezug.
    const terrainMaster = this.createMaster(
      scene,
      'terrain',
      MeshBuilder.CreateBox(
        'terrain',
        { width: TERRAIN_HALF_WIDTH * 2, height: 1.2, depth: SEGMENT_LENGTH },
        scene,
      ),
      new Color3(0.14, 0.13, 0.11),
    );
    const roadMaster = this.createMaster(
      scene,
      'road',
      MeshBuilder.CreateBox(
        'road',
        { width: ROAD_HALF_WIDTH * 2, height: 0.4, depth: SEGMENT_LENGTH },
        scene,
      ),
      new Color3(0.16, 0.17, 0.2),
    );
    const barrierMaster = this.createMaster(
      scene,
      'barrier',
      MeshBuilder.CreateBox(
        'barrier',
        { width: 0.7, height: 1.5, depth: SEGMENT_LENGTH * 0.92 },
        scene,
      ),
      new Color3(0.34, 0.3, 0.26),
    );
    const stripeMaster = this.createMaster(
      scene,
      'stripe',
      MeshBuilder.CreateBox('stripe', { width: 0.3, height: 0.05, depth: 2.6 }, scene),
      new Color3(0.75, 0.7, 0.45),
    );
    const debrisMaster = this.createMaster(
      scene,
      'debris',
      MeshBuilder.CreateBox('debris', { size: 1.4 }, scene),
      new Color3(0.28, 0.3, 0.28),
    );

    const count = Math.ceil((RENDER.farPlane + BEHIND_METERS) / SEGMENT_LENGTH) + 1;
    for (let i = 0; i < count; i += 1) {
      this.segments.push(
        this.createSegment(i, terrainMaster, roadMaster, barrierMaster, stripeMaster, debrisMaster),
      );
    }
    this.layout(0);
  }

  /**
   * Recycelt Segmente, die hinter dem Anker liegen, nach vorne.
   * `anchorZ` ist die Weltposition der Armee.
   */
  update(anchorZ: number): void {
    const cutoff = anchorZ - BEHIND_METERS;
    const total = this.segments.length;
    for (let guard = 0; guard < total; guard += 1) {
      const segment = this.segments[this.tail];
      if (!segment || segment.baseZ + SEGMENT_LENGTH >= cutoff) break;
      const frontIndex = (this.tail + total - 1) % total;
      const front = this.segments[frontIndex];
      if (!front) break;
      this.placeSegment(segment, front.baseZ + SEGMENT_LENGTH);
      this.tail = (this.tail + 1) % total;
    }
  }

  dispose(): void {
    for (const master of this.masters) master.dispose(false, true);
    this.masters.length = 0;
    this.segments.length = 0;
  }

  private layout(startZ: number): void {
    this.segments.forEach((segment, index) => {
      this.placeSegment(segment, startZ - BEHIND_METERS + index * SEGMENT_LENGTH);
    });
    this.tail = 0;
  }

  private placeSegment(segment: Segment, baseZ: number): void {
    segment.baseZ = baseZ;
    const center = baseZ + SEGMENT_LENGTH / 2;
    segment.terrain.position.set(0, TERRAIN_TOP - 0.6, center);
    segment.road.position.set(0, -0.2, center);
    segment.barrierLeft.position.set(-ROAD_HALF_WIDTH - 0.35, 0.55, center);
    segment.barrierRight.position.set(ROAD_HALF_WIDTH + 0.35, 0.55, center);

    segment.stripes.forEach((stripe, index) => {
      stripe.position.z = baseZ + 2 + index * 5;
    });

    // Trümmer stehen relativ zum Segment fest; beim Recyceln wandern sie
    // einfach mit. Ihr Muster stammt aus einem festen Seed pro Segment,
    // damit die Kulisse nicht bei jedem Durchlauf flackert.
    for (const piece of segment.debris) {
      piece.position.z = baseZ + piece.metadata.offsetZ;
    }
  }

  private createSegment(
    index: number,
    terrain: Mesh,
    road: Mesh,
    barrier: Mesh,
    stripe: Mesh,
    debris: Mesh,
  ): Segment {
    const rng = new Random(0x5eed + index * 7919);
    const stripes: InstancedMesh[] = [];
    for (let i = 0; i < 3; i += 1) {
      const node = stripe.createInstance(`stripe-${index}-${i}`);
      node.position.x = 0;
      node.position.y = 0.02;
      stripes.push(node);
    }

    const debrisPieces: InstancedMesh[] = [];
    const debrisCount = rng.int(1, 3);
    for (let i = 0; i < debrisCount; i += 1) {
      const node = debris.createInstance(`debris-${index}-${i}`);
      const side = rng.chance(0.5) ? -1 : 1;
      node.position.x = side * rng.range(ROAD_HALF_WIDTH + 2.2, TERRAIN_HALF_WIDTH * 0.65);
      node.rotation.y = rng.range(0, Math.PI);
      const scale = rng.range(0.6, 1.8);
      node.scaling.setAll(scale);
      // Truemmer stehen auf dem Gelaende, nicht darueber.
      node.position.y = TERRAIN_TOP + (DEBRIS_SIZE * scale) / 2;
      node.metadata = { offsetZ: rng.range(0, SEGMENT_LENGTH) };
      debrisPieces.push(node);
    }

    return {
      baseZ: 0,
      terrain: terrain.createInstance(`terrain-${index}`),
      road: road.createInstance(`road-${index}`),
      barrierLeft: barrier.createInstance(`barrier-l-${index}`),
      barrierRight: barrier.createInstance(`barrier-r-${index}`),
      stripes,
      debris: debrisPieces,
    };
  }

  private createMaster(scene: Scene, name: string, mesh: Mesh, color: Color3): Mesh {
    const material = new StandardMaterial(`${name}-mat`, scene);
    material.diffuseColor = color;
    // Kein Glanzlicht: der Stil ist flach und soll auf schwachen GPUs
    // nicht durch Specular-Berechnung teurer werden als noetig.
    material.specularColor = Color3.Black();
    material.freeze();

    mesh.material = material;
    // Das Master-Mesh selbst wird nicht gezeichnet, seine Instanzen schon.
    mesh.isVisible = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    this.masters.push(mesh);
    return mesh;
  }
}
