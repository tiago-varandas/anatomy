# Anatomy

Interactive isometric figures that explain how things work, built as standalone HTML pages.

- **Fig 1 · A neuron that learns** (`neuron-bench/`): four glass-tube neurons on a bench. Pair a bell with food and a synapse strengthens until the bell alone makes the output neuron fire (Hebbian learning / STDP, real membrane numbers).
- **Fig 2 · BMW iX3 on the bench** (`ix3/`): a 1:10 model of the 2025 Neue Klasse iX3. Take it apart into eight assemblies, launch it 0–100 km/h, or fast-charge it 10→80%, all driven by a model of the car's published figures.

- **Fig 3 · Anatomy of a DJ booth** (`dj-booth/`): two CDJ-3000X players and a DJM-A9 mixer you can play, with eight original synthesized tracks, Color FX, Beat FX and a live signal-flow overlay (Tone.js).

`site/` is the static build ready to deploy (open `site/index.html`).

## Build

Needs Node 20.10+.

```sh
node neuron-bench/build.mjs && node neuron-bench/build.mjs --light
node ix3/build.mjs && node ix3/build.mjs --light
node ix3/build.mjs --audit   # proves the geometry: clearances, depth order, supports
node dj-booth/build.mjs
```

The drawing kit in `kit/` and the check scripts in `scripts/` come from the [anatomy skill](https://github.com/wheresryan22/anatomy) (MIT, see `kit/LICENSE`).

Made by [Studio Little Nice Things](https://www.littlenicethings.com/).
