import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

const PALETTE = ["#4fc3a1", "#ff9d4d", "#6cc4ff", "#ff6b9d", "#b39ddb", "#ffd54f", "#81d4fa"];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function grassColor(health) {
  const r = Math.round(lerp(176, 63, health));
  const g = Math.round(lerp(138, 143, health));
  const b = Math.round(lerp(99, 79, health));
  return `rgb(${r}, ${g}, ${b})`;
}

function leafColor(health) {
  const r = Math.round(lerp(95, 31, health));
  const g = Math.round(lerp(157, 107, health));
  const b = Math.round(lerp(103, 58, health));
  return `rgb(${r}, ${g}, ${b})`;
}

function domainStats(domain) {
  const size = domain.islands.reduce((s, isl) => s + isl.size, 0);
  const health = domain.islands.length
    ? domain.islands.reduce((s, isl) => s + isl.health * isl.size, 0) / size
    : 0;
  return { size, health };
}

function Island({ domain, index, position, selected, onSelect }) {
  const { size, health } = domainStats(domain);
  const scale = 0.9 + Math.sqrt(size) * 0.18;
  const treeCount = Math.max(2, Math.round(2 + health * 5));
  const color = PALETTE[index % PALETTE.length];

  const trees = useMemo(() => {
    const out = [];
    for (let i = 0; i < treeCount; i++) {
      const a = (i / treeCount) * Math.PI * 2 + i;
      const rad = 0.5 + ((i * 37) % 100) / 100 * 1.3;
      out.push({ p: [Math.cos(a) * rad, 0, Math.sin(a) * rad], s: 0.5 + ((i * 53) % 100) / 100 * 0.5 });
    }
    return out;
  }, [treeCount]);

  return (
    <group
      position={position}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(domain.id);
      }}
    >
      <mesh position={[0, -1.5, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[2.4, 4.2, 8, 4]} />
        <meshStandardMaterial color="#7a6149" flatShading roughness={1} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[2.4, 2.3, 0.62, 12]} />
        <meshStandardMaterial color={grassColor(health)} flatShading roughness={0.9} />
      </mesh>
      {trees.map((t, i) => (
        <group key={i} position={t.p} scale={t.s}>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.06, 0.1, 0.9, 6]} />
            <meshStandardMaterial color="#6b4632" flatShading roughness={1} />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <coneGeometry args={[0.5, 0.7, 6]} />
            <meshStandardMaterial color={leafColor(health)} flatShading roughness={0.95} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.4, 0]}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 2.4 : 0.7} />
      </mesh>
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

  const positions = useMemo(() => {
    const n = domains.length || 1;
    return domains.map((_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [Math.cos(a) * 7, 0, Math.sin(a) * 7];
    });
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
        camera={{ position: [0, 16, 14], fov: 50 }}
        onPointerMissed={() => {
          setSelected(null);
          setFocus(new THREE.Vector3(0, 0, 0));
        }}
      >
        <color attach="background" args={["#7ec8e3"]} />
        <fog attach="fog" args={["#7ec8e3", 30, 90]} />
        <hemisphereLight args={["#ffffff", "#4a6b5a", 1.0]} />
        <directionalLight position={[10, 20, 8]} intensity={2.0} color="#fff2d8" castShadow shadow-mapSize={[1024, 1024]} />
        <ambientLight intensity={0.35} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.5, 0]}>
          <circleGeometry args={[40, 48]} />
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
          enablePan={false}
          minDistance={6}
          maxDistance={45}
          minPolarAngle={0.25}
          maxPolarAngle={1.45}
          enableDamping
          dampingFactor={0.08}
          target={[0, 0, 0]}
        />
      </Canvas>

      <div className="overlay">
        <div className="title">
          <h1>Korean <em>Islands</em></h1>
          <p className="sub">
            {data ? `${data.total_words} words · ${Math.round(data.overall_health * 100)}% healthy · drag to orbit, tap an island` : "Loading…"}
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
          <p className="hint">Drag to orbit · scroll/pinch to zoom</p>
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
