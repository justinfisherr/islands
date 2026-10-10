import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

const PALETTE = ["#4fc3a1", "#ff9d4d", "#6cc4ff", "#ff6b9d", "#b39ddb", "#ffd54f", "#81d4fa"];

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function domainStats(domain) {
  const size = domain.islands.reduce((s, isl) => s + isl.size, 0);
  const health = domain.islands.length
    ? domain.islands.reduce((s, isl) => s + isl.health * isl.size, 0) / size
    : 0;
  return { size, health };
}

// Health -> a full island "theme", from scorched lava up to waterfall paradise.
function islandTheme(health) {
  const h = Math.max(0, Math.min(1, health));

  let rock, ground;
  if (h < 0.2) { rock = "#26221f"; ground = "#3a2b22"; }
  else if (h < 0.35) { rock = "#4a3a2e"; ground = "#6e5038"; }
  else if (h < 0.5) { rock = "#6b513a"; ground = "#8a6a44"; }
  else if (h < 0.65) { rock = "#6b5c42"; ground = "#9c9266"; }
  else if (h < 0.8) { rock = "#5e6a44"; ground = "#6fae66"; }
  else { rock = "#3f5c3f"; ground = "#38a148"; }

  const lava = h < 0.25 ? (0.25 - h) / 0.25 : 0;          // 1 -> 0 as health rises to .25
  const waterfall = h > 0.85 ? (h - 0.85) / 0.15 : 0;       // 0 -> 1 from .85 to 1

  let treeCount = 0;
  if (h >= 0.25 && h < 0.5) treeCount = Math.round((h - 0.25) * 8);      // 0..2
  else if (h >= 0.5) treeCount = Math.round(2 + (h - 0.5) * 14);         // 2..9

  return { rock, ground, lava, waterfall, treeCount };
}

function Island({ domain, index, position, selected, onSelect }) {
  const { size, health } = domainStats(domain);
  const theme = islandTheme(health);
  const scale = 0.8 + Math.sqrt(size) * 0.15;
  const color = PALETTE[index % PALETTE.length];

  const trees = useMemo(() => {
    const out = [];
    for (let i = 0; i < theme.treeCount; i++) {
      const a = (i / Math.max(1, theme.treeCount)) * Math.PI * 2 + i * 1.3;
      const rad = 0.5 + ((i * 37) % 100) / 100 * 1.4;
      out.push({ p: [Math.cos(a) * rad, 0, Math.sin(a) * rad], s: 0.5 + ((i * 53) % 100) / 100 * 0.55 });
    }
    return out;
  }, [theme.treeCount]);

  return (
    <group
      position={position}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(domain.id);
      }}
    >
      {/* rock */}
      <mesh position={[0, -1.5, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[2.4, 4.2, 8, 4]} />
        <meshStandardMaterial color={theme.rock} flatShading roughness={1} />
      </mesh>
      {/* ground */}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[2.4, 2.3, 0.62, 12]} />
        <meshStandardMaterial color={theme.ground} flatShading roughness={0.9} />
      </mesh>

      {/* lava pool for the lowest-health islands */}
      {theme.lava > 0 && (
        <>
          <mesh position={[0, 0.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.3, 20]} />
            <meshStandardMaterial color="#ff5c1a" emissive="#ff3d00" emissiveIntensity={2.2} roughness={0.25} />
          </mesh>
          <pointLight position={[0, 1.4, 0]} color="#ff6b2a" intensity={2.5 * theme.lava} distance={5} />
        </>
      )}

      {/* trees */}
      {trees.map((t, i) => (
        <group key={i} position={t.p} scale={t.s}>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.06, 0.1, 0.9, 6]} />
            <meshStandardMaterial color="#6b4632" flatShading roughness={1} />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <coneGeometry args={[0.5, 0.7, 6]} />
            <meshStandardMaterial color="#2e7d3a" flatShading roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* waterfall for the highest-health islands */}
      {theme.waterfall > 0 && (
        <group>
          <mesh position={[1.3, -0.6, 0]}>
            <boxGeometry args={[0.35, 3.6, 0.12]} />
            <meshStandardMaterial color="#7fd6e8" transparent opacity={0.75} roughness={0.2} />
          </mesh>
          <mesh position={[1.3, 1.1, 0]}>
            <sphereGeometry args={[0.9, 12, 12]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.28} roughness={0.4} />
          </mesh>
        </group>
      )}

      {/* marker orb */}
      <mesh position={[0, 2.4, 0]}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 2.4 : 0.7} />
      </mesh>

      <Html center distanceFactor={22} position={[0, 3.2, 0]}>
        <button className={`island-label ${selected ? "active" : ""}`} onClick={() => onSelect(domain.id)}>
          {domain.name}
          <span className="count">{size}</span>
        </button>
      </Html>
    </group>
  );
}

function CameraRig({ focus }) {
  useFrame(({ controls }) => {
    const c = controls;
    if (!c || !focus) return;
    c.target.lerp(focus, 0.08);
    c.update();
  });
  return null;
}

export default function App() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    fetch("data.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const domains = data?.domains || [];

  // random-but-traversable scatter: seeded, with minimum spacing
  const positions = useMemo(() => {
    const n = domains.length || 1;
    const rng = mulberry32(20261010);
    const pts = [];
    let attempts = 0;
    while (pts.length < n && attempts < 2000) {
      const a = rng() * Math.PI * 2;
      const rad = 5 + rng() * 13;
      const p = [Math.cos(a) * rad, 0, Math.sin(a) * rad];
      const minDist = 8.5;
      const ok = pts.every((q) => Math.hypot(p[0] - q[0], p[2] - q[2]) >= minDist);
      if (ok) pts.push(p);
      attempts++;
    }
    return pts;
  }, [domains]);

  const selectedDomain = domains.find((d) => d.id === selected) || null;

  const select = (id) => {
    setSelected(id);
    const idx = domains.findIndex((d) => d.id === id);
    if (idx >= 0 && positions[idx]) {
      setFocus(new THREE.Vector3(positions[idx][0], positions[idx][1], positions[idx][2]));
    }
  };

  const close = () => {
    setSelected(null);
    setFocus(new THREE.Vector3(0, 0, 0));
  };

  return (
    <div className="app">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 26, 24], fov: 52 }}
        onPointerMissed={() => {
          setSelected(null);
          setFocus(new THREE.Vector3(0, 0, 0));
        }}
      >
        <color attach="background" args={["#7ec8e3"]} />
        <fog attach="fog" args={["#7ec8e3", 40, 110]} />
        <hemisphereLight args={["#ffffff", "#4a6b5a", 1.0]} />
        <directionalLight position={[14, 28, 10]} intensity={2.0} color="#fff2d8" castShadow shadow-mapSize={[2048, 2048]} />
        <ambientLight intensity={0.35} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]}>
          <circleGeometry args={[90, 64]} />
          <meshStandardMaterial color="#2e7fb0" roughness={0.9} />
        </mesh>

        {domains.map((d, i) => (
          <Island
            key={d.id}
            domain={d}
            index={i}
            position={positions[i]}
            selected={selected === d.id}
            onSelect={select}
          />
        ))}

        <CameraRig focus={focus} />
        <OrbitControls
          makeDefault
          enablePan
          screenSpacePanning={false}
          minDistance={6}
          maxDistance={70}
          minPolarAngle={0.2}
          maxPolarAngle={1.5}
          enableDamping
          dampingFactor={0.08}
          target={[0, 0, 0]}
        />
      </Canvas>

      <div className="overlay">
        <div className="title">
          <h1>Korean <em>Islands</em></h1>
          <p className="sub">
            {data ? `${data.total_words} words · ${Math.round(data.overall_health * 100)}% healthy · drag to orbit, pinch to zoom` : "Loading…"}
          </p>
        </div>

        <div>
          <div className="legend">
            {domains.map((d, i) => {
              const stats = domainStats(d);
              return (
                <button
                  key={d.id}
                  className={selected === d.id ? "active" : ""}
                  onClick={() => (selected === d.id ? close() : select(d.id))}
                >
                  <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {d.name}
                  <span style={{ color: "#8fa6b8" }}>{stats.size}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">Drag to orbit · right-drag / two-finger to travel · scroll to zoom</p>
        </div>
      </div>

      <div className={`panel ${selectedDomain ? "open" : ""}`}>
        {selectedDomain && (
          <>
            <button className="close" onClick={close}>×</button>
            <h2>
              {selectedDomain.name} <em>{selectedDomain.name_native}</em>
            </h2>
            <div className="meta">
              {selectedDomain.islands.length} islands · {domainStats(selectedDomain).size} words ·{" "}
              {Math.round(domainStats(selectedDomain).health * 100)}% healthy
            </div>
            {selectedDomain.islands.map((isl) => (
              <section key={isl.id}>
                <h3 style={{ fontSize: 14, margin: "10px 0 4px", color: "#cfe3ee" }}>
                  {isl.name} <span style={{ color: "#8fa6b8", fontWeight: 400 }}>{isl.name_native}</span>
                </h3>
                {isl.words.map((w) => (
                  <div className="word" key={w.term}>
                    <div className="term">
                      {w.term}
                      {w.base_form ? <span className="base">({w.base_form})</span> : null}
                    </div>
                    <div className="meaning">{w.meaning}</div>
                    {w.example ? <div className="example">“{w.example}”</div> : null}
                    {w.example_en ? <div className="ex-en">{w.example_en}</div> : null}
                    {w.mnemonic ? <div className="mnem">💡 {w.mnemonic}</div> : null}
                    <div style={{ marginTop: 4 }}>
                      <span className={`badge ${w.status}`}>
                        {w.status}
                        {w.status === "review" && w.interval_days ? ` · ${w.interval_days}d` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
