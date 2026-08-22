import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
// Side-Effect-Import: ohne ihn kennt Mesh.createInstance() seine
// Implementierung nicht (Babylon-Tree-Shaking).
import '@babylonjs/core/Meshes/instancedMesh';
import type { Scene } from '@babylonjs/core/scene';
import { getTier } from '../../config/unitTiers';
import { clamp } from '../../util/math';

/** Feste Platzhalter-Formation, bis der echte Crowd-Renderer steht. */
const FORMATION: ReadonlyArray<readonly [number, number]> = [
  [0, 1.2],
  [-1.1, 0],
  [1.1, 0],
  [-2.1, -1.3],
  [0, -1.3],
  [2.1, -1.3],
];

/**
 * Platzhalter fuer die Armee.
 *
 * Phase 1 zeigt bewusst nur eine feste Handvoll Figuren: die eigentliche
 * Crowd — Instancing, Formation, Display Count — ist Phase 2 und haengt am
 * Armee-System, das es noch nicht gibt. Was hier schon stimmt, sind
 * Massstab, Farbe des Tiers und das Bewegungsgefuehl (Neigung beim Lenken),
 * damit Kamera und Steuerung jetzt bewertbar sind.
 */
export class SquadMarker {
  private readonly master: Mesh;
  private readonly units: InstancedMesh[] = [];
  private tilt = 0;

  constructor(scene: Scene, tierIndex: number) {
    const tier = getTier(tierIndex);
    const [r, g, b] = tier.visual.color;

    const material = new StandardMaterial('soldier-mat', scene);
    material.diffuseColor = new Color3(r, g, b);
    material.specularColor = Color3.Black();
    material.emissiveColor = new Color3(r * 0.12, g * 0.12, b * 0.12);
    material.freeze();

    this.master = MeshBuilder.CreateBox(
      'soldier',
      { width: 0.7, height: 1.7, depth: 0.5 },
      scene,
    );
    this.master.material = material;
    this.master.isVisible = false;
    this.master.isPickable = false;
    this.master.doNotSyncBoundingInfo = true;

    FORMATION.forEach(([offsetX, offsetZ], index) => {
      const unit = this.master.createInstance(`soldier-${index}`);
      unit.scaling.setAll(tier.visual.scale);
      unit.metadata = { offsetX, offsetZ };
      this.units.push(unit);
    });
  }

  /**
   * @param x Lateralposition des Ankers in Metern
   * @param z Vorwaertsposition des Ankers in Metern
   * @param lateralVelocity m/s — erzeugt die Neigung in die Kurve
   * @param time Sekunden seit Rundenstart — treibt den Laufzyklus
   */
  update(x: number, z: number, lateralVelocity: number, time: number): void {
    // Neigung geglaettet nachziehen, sonst zuckt die Formation bei jedem
    // Richtungswechsel.
    const targetTilt = clamp(-lateralVelocity * 0.05, -0.28, 0.28);
    this.tilt += (targetTilt - this.tilt) * 0.15;

    this.units.forEach((unit, index) => {
      const meta = unit.metadata as { offsetX: number; offsetZ: number };
      // Statt einer Skelettanimation reicht ein versetzter Sinus-Hopser:
      // auf Distanz nicht von einem Laufzyklus zu unterscheiden und
      // praktisch kostenlos (PLAN.md R1).
      const bob = Math.abs(Math.sin(time * 9 + index * 1.7)) * 0.16;
      unit.position.set(x + meta.offsetX, 0.85 + bob, z + meta.offsetZ);
      unit.rotation.z = this.tilt;
    });
  }

  dispose(): void {
    this.master.dispose(false, true);
    this.units.length = 0;
  }
}
