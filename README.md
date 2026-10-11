# Fluidtorio

A browser game about buoyancy, load paths and learning fast.

Your lander broke up over **Strata**, a world of stacked liquids that won't mix, under a volcano that is waking up. Build a floating colony out of materials nobody has tested. Hang a keel down into the fuel deep and raise a tower into the oxidiser sky. Refine propellant, stack a rocket and reach escape speed before the eruption.

Nothing comes with a datasheet. Each planet is procedurally generated:
- the fluid layers, their densities and currents
- five raw materials, each with hidden density, strength, brittleness and reactions to each layer
- a hidden "temper" rule that decides which alloys are superb, ordinary, crumbly or explosive

The fastest way off the planet is to learn quickly and cheaply what you are building with.

## How it opens

You start with almost nothing: a raft, a grapple, some salvage, and two kinds of block (Float and Frame). One goal at a time sits under the countdown. Everything else arrives when the world gives you a reason for it:

| When | You get |
|---|---|
| your first unknown sample comes aboard | the notebook, the Drop tool and the density lens |
| you try to grab something out of reach, or haul a few loads | the Crane |
| a keel (or a chunk hauled up from the deep) touches the fuel layer | the Pump |
| a tower breaks into the oxidiser sky | the Condenser |
| the first joint cracks, or you start pumping | the Smelter and the alloy table |
| you have both fuel and oxidiser | the Refinery |
| you have propellant | the rocket parts and the launch forecast |

New kinds of flotsam drift in one at a time, so you meet one unknown material before the next.

Every HUD element has a short tooltip. The two numbers that matter most are always on screen: spare **lift** and **heel**. Every build preview shows what it does to your lift, and how uncertain that is given what you know about the material.

## How it plays

- **Floating is physics.** Each block displaces fluid in every layer it touches (Archimedes, per block, per layer). Rafts heel, and tall towers capsize light rafts. A heavy keel stabilises you, while a buoyant keel tries to flip you.
- **Load is physics too.** Weight is routed through welded joints to whatever holds it up, using a graph-Laplacian load-path solver. Joints carry vertical load well and sideways load poorly. Overloaded joints creak, crack, glow and snap, and the pieces fall into the sea. Ductile materials warn you early; brittle ones barely warn at all.
- **You only know what you've seen happen.** There is no lab and no datasheet. The notebook keeps each property as an interval, and hovering a property lists the experiments behind it. You narrow it with physical experiments, each with its own costs and noise:
  - **Drop a test cube.** It shows where the material settles between the liquids, and how deep it floats (a cube floating at an interface is a hydrometer). It also shows what it does in every layer it sinks through.
  - **Weigh on the deck.** Every block you add pushes the raft down, so the raft is a scale. Weigh several blocks of one material at once, solid rather than hollow, in calm water. Put two unknowns on together and you can't tell which weighs what. A known material on the scale with an unknown one still works.
  - **Load joints.** Joints that hold set a floor on strength; joints that crack or snap set a ceiling. Dense blocks stacked on a test joint load it fastest. Brittle materials barely warn you.
  - **Leave something in a layer.** Corrosion and swelling show at once, and a few calm seconds with no reaction means inert.
  - **Smelt a pair.** It's the only way to learn an alloy, and some pairs explode. Smelt untested pairs on a limb, away from the core. Each result constrains the hidden rule behind every other pair.
- **Forecasts are built from what you know.** The stress view, build previews and the launch forecast use only your knowledge. Green means certainly fine, amber means it depends on what you don't know yet, and red means certain failure.
- **Retrying keeps your notebook.** Try the same planet again and your notebook carries over, so a failed run is still an experiment.

## How it looks

The world is drawn from its density field. Each frame, the objects and heat sources are painted into a density buffer and combined with the analytic fluid layers on the GPU. Gradients of that field drive two things:
- **Refraction:** the shimmer above smelters and the volcano, and the lensing at the oil/brine interfaces.
- **Colour schlieren:** hold <kbd>Shift</kbd> for a lens, or press <kbd>Tab</kbd> for the whole screen. You see density directly. A chunk that matches its surroundings disappears, and heat plumes and shockwaves become visible.

## Controls

| | |
|---|---|
| Hover anything | a short explanation |
| <kbd>G</kbd>, then click open water | drop a test cube |
| Click chunk / wreck | grapple it in |
| <kbd>1</kbd>–<kbd>0</kbd>, <kbd>T</kbd>, <kbd>C</kbd> | pick a block to build |
| <kbd>Q</kbd> / <kbd>E</kbd> | cycle material |
| Click / drag | place blocks |
| Right-click block | dismantle (75% refund) |
| <kbd>R</kbd> / <kbd>J</kbd> / <kbd>X</kbd> | patch / jettison / dismantle tool |
| Right-drag, <kbd>WASD</kbd>, wheel | pan, zoom |
| <kbd>Space</kbd>, <kbd>,</kbd> <kbd>.</kbd> | pause, slower, faster |
| Hold <kbd>Shift</kbd> / <kbd>Tab</kbd> / <kbd>V</kbd> | schlieren lens / schlieren view / stress view |
| <kbd>N</kbd>, <kbd>H</kbd>, <kbd>F</kbd>, <kbd>M</kbd> | notebook, help, find colony, mute |

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

The stack is plain JavaScript modules, [planck.js](https://github.com/piqnt/planck.js) (Box2D) for rigid bodies and contacts, WebGL2 for the sea and the post-processing, Canvas2D for the object and density layers, and Web Audio for all sound, which is synthesised.

Layout:
- `src/sim/` is the simulation: planet generation, sea and waves, buoyancy, structures, the stress solver, knowledge, flotsam, labs, the rocket and the volcano. It runs headless in Node.
- `src/render/` is the renderer: the density-field shader, material textures and particles.
- `src/ui.js` and `src/main.js` are the HUD, notebook, input and game loop.
- `src/audio.js` is the synthesised sound.

## Deploying

The project is a zero-config Vite static site (`vercel.json` included). Import the repository at [vercel.com/new](https://vercel.com/new) and every push deploys.

To deploy from the CLI instead:

```bash
npx vercel --prod
```
