import * as THREE from "three";
import { makeConfig } from "./core/environment.mjs";
import { OrbitControls } from "./vendor/OrbitControls.js";
export class WorldView {
  constructor(container) {
    this.container = container;
    this.mode = "follow";
    this.lastOcean = -1;
    this.pathPoints = [];
    this.lastPath = -1;
    this.rotors = [];
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#54788b");
    this.scene.fog = new THREE.FogExp2("#54788b", 0.006);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 800);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-24, -29, 20);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor("#54788b");
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 4);
    this.controls.enableDamping = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 100;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight("#c1e2ef", "#183b42", 2.4));
    this.sun = new THREE.DirectionalLight("#fff1da", 3);
    this.sun.position.set(-20, -15, 60);
    this.scene.add(this.sun);
    this.oceanGeo = new THREE.PlaneGeometry(200, 200, 105, 105);
    this.oceanBase = Float32Array.from(this.oceanGeo.attributes.position.array);
    this.oceanMat = new THREE.MeshStandardMaterial({
      color: "#126879",
      roughness: 0.3,
      metalness: 0.28,
      side: THREE.DoubleSide,
    });
    this.ocean = new THREE.Mesh(this.oceanGeo, this.oceanMat);
    this.scene.add(this.ocean);
    this.farOcean = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshStandardMaterial({
        color: "#126879",
        roughness: 0.45,
        metalness: 0.15,
      }),
    );
    this.farOcean.position.z = -0.5;
    this.scene.add(this.farOcean);
    this.buildShip();
    this.buildDrone();
    this.path = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: "#67efe2",
        transparent: true,
        opacity: 0.75,
      }),
    );
    this.scene.add(this.path);
    this.beam = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: "#ffca72",
        dashSize: 0.35,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.beam);
    this.windArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 9),
      3,
      "#b5cbec",
      0.5,
      0.3,
    );
    this.scene.add(this.windArrow);
    const rainGeo = new THREE.BufferGeometry(),
      pts = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 70;
      pts[i * 3 + 1] = (Math.random() - 0.5) * 70;
      pts[i * 3 + 2] = Math.random() * 35;
    }
    rainGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    this.rain = new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({
        color: "#c0dbeb",
        size: 0.065,
        transparent: true,
        opacity: 0.6,
      }),
    );
    this.scene.add(this.rain);
    this.lastShip = new THREE.Vector3();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  box(parent, size, pos, color, rough = 0.7) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      new THREE.MeshStandardMaterial({ color, roughness: rough }),
    );
    mesh.position.set(...pos);
    parent.add(mesh);
    return mesh;
  }
  buildShip(c = makeConfig()) {
    this.ship = new THREE.Group();
    this.scene.add(this.ship);
    const body = new THREE.Group();
    body.scale.set(c.shipLength / 16, c.shipBeam / 5.8, c.freeboard / 2);
    this.ship.add(body);
    const shape = new THREE.Shape();
    shape.moveTo(-8, -2.9);
    shape.lineTo(5.8, -2.9);
    shape.lineTo(8, 0);
    shape.lineTo(5.8, 2.9);
    shape.lineTo(-8, 2.9);
    shape.closePath();
    const hull = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 2.3,
        bevelEnabled: true,
        bevelSize: 0.12,
        bevelThickness: 0.12,
        bevelSegments: 1,
        steps: 1,
      }),
      new THREE.MeshStandardMaterial({ color: "#344c59", roughness: 0.55 }),
    );
    hull.position.z = -2.4;
    body.add(hull);
    this.box(body, [13.8, 5.65, 0.12], [-0.8, 0, -0.02], "#9da9a9");
    this.box(body, [3.8, 3.6, 2.4], [4.45, 0, 1.2], "#dce6e1");
    this.box(body, [3.95, 3.8, 0.15], [4.45, 0, 2.45], "#a3baba");
    this.box(body, [2.8, 0.035, 0.7], [4.3, -1.815, 1.65], "#153c52", 0.2);
    this.box(body, [0.035, 2.3, 0.7], [6.36, 0, 1.65], "#153c52", 0.2);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 3, 8),
      new THREE.MeshStandardMaterial({ color: "#d0dedc" }),
    );
    mast.rotation.x = Math.PI / 2;
    mast.position.set(4.6, 0, 3.85);
    body.add(mast);
    this.box(body, [1.4, 0.12, 0.1], [4.6, 0, 4.8], "#b6cecb");
    for (const y of [-2.7, 2.7]) {
      this.box(body, [14, 0.035, 0.035], [-0.7, y, 0.6], "#d7e5e4");
      for (let x = -7.5; x < 6.5; x += 2)
        this.box(body, [0.035, 0.035, 0.6], [x, y, 0.3], "#a6bdbf");
    }
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(c.padRadius, 64),
      new THREE.MeshStandardMaterial({ color: "#244645", roughness: 0.9 }),
    );
    disk.position.set(c.padOffset[0], c.padOffset[1], 0.09);
    this.ship.add(disk);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(c.padRadius * 0.88, c.padRadius * 0.93, 64),
      new THREE.MeshBasicMaterial({ color: "#ffbe65", side: THREE.DoubleSide }),
    );
    ring.position.set(c.padOffset[0], c.padOffset[1], 0.1);
    this.ship.add(ring);
    for (const y of [-0.38, 0.38])
      this.box(
        this.ship,
        [0.14, 1.2, 0.015],
        [c.padOffset[0] + y, c.padOffset[1], 0.11],
        "#ffce87",
      );
    this.box(
      this.ship,
      [0.85, 0.13, 0.015],
      [c.padOffset[0], c.padOffset[1], 0.12],
      "#ffce87",
    );
  }
  buildDrone() {
    this.drone = new THREE.Group();
    this.scene.add(this.drone);
    this.box(this.drone, [0.35, 0.28, 0.14], [0, 0, 0], "#f5f8f5");
    this.box(this.drone, [0.18, 0.18, 0.05], [0, 0, 0.1], "#314752");
    for (const [x, y] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const arm = this.box(
        this.drone,
        [0.65, 0.05, 0.045],
        [0, 0, 0],
        "#293e4d",
      );
      arm.rotation.z = Math.atan2(y, x);
      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.07, 10),
        new THREE.MeshStandardMaterial({ color: "#252f3c" }),
      );
      motor.rotation.x = Math.PI / 2;
      motor.position.set(x * 0.226, y * 0.226, 0.035);
      this.drone.add(motor);
      const rotor = new THREE.Group();
      rotor.position.set(x * 0.226, y * 0.226, 0.08);
      this.box(rotor, [0.32, 0.025, 0.008], [0, 0, 0], "#9cddd3");
      this.box(rotor, [0.025, 0.32, 0.008], [0, 0, 0], "#9cddd3");
      this.drone.add(rotor);
      this.rotors.push(rotor);
    }
    for (const y of [-0.12, 0.12]) {
      this.box(this.drone, [0.035, 0.035, 0.2], [0, y, -0.14], "#4c6973");
      this.box(this.drone, [0.4, 0.035, 0.025], [0, y, -0.255], "#203b45");
    }
    // Render at physical scale; halo makes small aircraft visible without enlarging the body.
    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.53, 48),
      new THREE.MeshBasicMaterial({
        color: "#73fff0",
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    this.halo.position.z = 0.02;
    this.drone.add(this.halo);
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  reset(sim) {
    this.sim = sim;
    if (this.ship) {
      this.ship.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(this.ship);
    }
    this.buildShip(sim.config);
    this.drone.scale.set(
      sim.config.armRadius / 0.32,
      sim.config.armRadius / 0.32,
      1,
    );
    this.lastOcean = -1;
    this.pathPoints = [];
    this.lastPath = -1;
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry();
    this.lastShip.set(...sim.ship.position);
    this.controls.target.copy(this.lastShip).add(new THREE.Vector3(0, 0, 3));
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(-24, -27, 17));
    const storm = sim.config.rain;
    const sky = new THREE.Color().lerpColors(
      new THREE.Color("#7199ab"),
      new THREE.Color("#263948"),
      storm,
    );
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(
      sky,
      Math.max(0.004, 1.5 / sim.config.visibility),
    );
    this.sun.intensity = 3 - 2.1 * storm;
    this.rain.visible = storm > 0;
    this.oceanMat.color.set(storm > 0.5 ? "#154651" : "#146778");
    this.farOcean.material.color.copy(this.oceanMat.color);
    this.draw(sim.snapshot());
  }
  draw(state) {
    if (!this.sim) return;
    this.ship.position.set(...state.ship.position);
    this.ship.quaternion.set(...state.ship.quaternion);
    this.drone.position.set(...state.drone.position);
    this.drone.quaternion.set(...state.drone.quaternion);
    this.rotors.forEach(
      (r, i) =>
        (r.rotation.z =
          state.time * (60 + state.drone.motors[i] * 4) * (i % 2 ? 1 : -1)),
    );
    if (state.time < this.lastPath) {
      this.pathPoints = this.sim.log
        .filter(
          (_, i) =>
            i % Math.max(1, Math.ceil(this.sim.log.length / 1800)) === 0,
        )
        .map((s) => new THREE.Vector3(...s.drone.position));
      this.lastOcean = -1;
    }
    if (state.time !== this.lastPath) {
      this.pathPoints.push(new THREE.Vector3(...state.drone.position));
      if (this.pathPoints.length > 1800) this.pathPoints.shift();
      this.path.geometry.dispose();
      this.path.geometry = new THREE.BufferGeometry().setFromPoints(
        this.pathPoints,
      );
      this.lastPath = state.time;
    }
    const p = state.ship.position;
    if (this.lastOcean < 0 || Math.abs(state.time - this.lastOcean) > 0.08) {
      const pos = this.oceanGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = this.oceanBase[i * 3] + p[0],
          y = this.oceanBase[i * 3 + 1] + p[1];
        pos.setXYZ(i, x, y, this.sim.ocean.sample(x, y, state.time).height);
      }
      pos.needsUpdate = true;
      this.oceanGeo.computeVertexNormals();
      this.lastOcean = state.time;
      this.farOcean.position.set(
        p[0],
        p[1],
        this.sim.ocean.tide(state.time) - Math.max(2, this.sim.config.hs * 4),
      );
    }
    this.beam.geometry.dispose();
    this.beam.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...state.drone.position),
      new THREE.Vector3(...state.ship.pad.position),
    ]);
    this.beam.computeLineDistances();
    this.beam.visible = Boolean(state.observation.deck);
    const wind = new THREE.Vector3(...state.wind);
    this.windArrow.position
      .copy(this.ship.position)
      .add(new THREE.Vector3(0, 0, 8));
    if (wind.length() > 0.01) {
      this.windArrow.setDirection(wind.clone().normalize());
      this.windArrow.setLength(
        Math.min(7, Math.max(1, wind.length() * 0.4)),
        0.5,
        0.25,
      );
    }
    const points = this.rain.geometry.attributes.position;
    this.rain.position.copy(this.ship.position);
    if (this.rain.visible)
      for (let i = 0; i < points.count; i++) {
        points.setZ(i, 35 - ((i * 1.117 + state.time * 11) % 35));
      }
    points.needsUpdate = true;
    const target = new THREE.Vector3(...p).add(new THREE.Vector3(-1, 0, 3));
    if (this.mode === "follow") {
      this.controls.target.lerp(target, 0.12);
      const goal = target.clone().add(new THREE.Vector3(-22, -25, 16));
      this.camera.position.lerp(goal, 0.04);
    } else if (this.mode === "drone") {
      const dp = new THREE.Vector3(...state.drone.position);
      this.controls.target.lerp(dp, 0.16);
      this.camera.position.lerp(
        dp.clone().add(new THREE.Vector3(-4, -6, 3)),
        0.07,
      );
    } else if (this.mode === "top") {
      this.controls.target.lerp(target, 0.15);
      this.camera.position.lerp(
        target.clone().add(new THREE.Vector3(-0.1, -0.1, 37)),
        0.09,
      );
    } else {
      const delta = new THREE.Vector3(...p).sub(this.lastShip);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.lastShip.set(...p);
    this.controls.update();
    const screen = this.drone.position
        .clone()
        .add(new THREE.Vector3(0, 0, 0.7))
        .project(this.camera),
      tag = document.getElementById("drone-tag");
    if (tag) {
      tag.style.left = ((screen.x + 1) / 2) * this.container.clientWidth + "px";
      tag.style.top =
        ((-screen.y + 1) / 2) * this.container.clientHeight + "px";
      tag.hidden =
        Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || screen.z > 1;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
