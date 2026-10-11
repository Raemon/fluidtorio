# Fluidtorio

A browser game about buoyancy, load paths and learning fast.

Your lander broke up over **Strata**, a world of stacked liquids that won't mix, under a volcano that is waking up. Build a floating colony out of materials nobody has tested. Hang a keel down into the fuel deep and raise a tower into the oxidiser sky. Refine propellant, stack a rocket and reach escape speed before the eruption.

Nothing comes with a datasheet. Each planet is procedurally generated:
- the fluid layers, their densities and currents
- five raw materials, each with hidden density, strength, brittleness and reactions to each layer
- a hidden "temper" rule that decides which alloys are superb, ordinary, crumbly or explosive

The fastest way off the planet is to learn quickly and cheaply what you are building with.

## How it plays

- **Floating is physics.** Each block displaces fluid in every layer it touches (Archimedes, per block, per layer). Rafts heel, and tall towers capsize light rafts. A heavy keel stabilises you, while a buoyant keel tries to flip you.
- **Load is physics too.** Weight is routed through welded joints to whatever holds it up, using a graph-Laplacian load-path solver. Joints carry vertical load well and sideways load poorly. Overloaded joints creak, crack, glow and snap, and the pieces fall into the sea. Ductile materials warn you early; brittle ones barely warn at all.
- **You only know what you've observed.** The notebook keeps each property as an interval. Several things narrow it:
  - where a material's chunks float, and their waterline
  - loads its joints have held, and where they cracked
  - whether it fizzes in a layer
  - lab tests, which are exact but cost samples and time
- **Forecasts are built from what you know.** The stress view, build previews and the launch forecast use only your knowledge. Green means certainly fine, amber means it depends on what you don't know yet, and red means certain failure.
- **Retrying keeps your notebook.** Try the same planet again and your notebook carries over, so a failed run is still an experiment.

## How it looks

The world is drawn from its density field. Each frame, the objects and heat sources are painted into a density buffer and combined with the analytic fluid layers on the GPU. Gradients of that field drive two things:
- **Refraction:** the shimmer above smelters and the volcano, and the lensing at the oil/brine interfaces.
- **Colour schlieren:** hold <kbd>Shift</kbd> for a lens, or press <kbd>Tab</kbd> for the whole screen. You see density directly. A chunk that matches its surroundings disappears, and heat plumes and shockwaves become visible.

## Controls

| | |
|---|---|
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
