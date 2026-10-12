# Fluidtorio

A browser game about buoyancy, load paths and learning fast.

Your lander broke up over **Strata**, a world of stacked liquids that won't mix, under a volcano that is waking up. You start with one survivor on a raft in a field of wreckage. Fish in what you can, find the others, and grow a floating colony out of materials nobody has tested. Hang a keel down into the fuel deep and raise a tower into the oxidiser sky. Refine propellant, stack a rocket and reach escape speed before the eruption.

Nothing comes with a datasheet. Each planet is procedurally generated:
- the fluid layers, their densities and currents
- five raw materials, each with hidden density, strength, brittleness and reactions to each layer
- a hidden "temper" rule that decides which alloys are superb, ordinary, crumbly or explosive
- the sea around you: a wreck field, an escape pod, a pumice raft, a basalt stack rooted to the floor, and a far wreck, each with its own flotsam and (sometimes) a survivor

The fastest way off the planet is to learn quickly and cheaply what you are building with.

## How it opens

You have one colonist, Ada, a raft, the lander core and two crates of salvage. The first goal is just "Fish in the wreckage": click something floating, and Ada walks to the edge and casts a line for it.

- **What you haul in stays physical.** It lands on the deck as an object with weight. It slides when the raft rolls, it can go over the side, and it pushes the raft down. The hull has load-line marks so you can see how far.
- **A Stockpile is the first thing you build.** You plan it, and Ada fetches salvage from a crate and builds it. Then she carries loose cargo into it. Stores are what is physically on the raft, not a number in a menu.
- **A flare goes up.** Someone survived. Click the lander core to row toward them (a heavy raft rows slower), get within a cast, and fish them out of the sea. Now you have two pairs of hands.
- **You can steer anyone directly, but mostly you won't.** Click a colonist to give them orders, or set them to fish by themselves. Planned blocks get fetched and built by whoever is free. A Crane fishes further than anyone can cast.

The game never tells you to measure anything. It doesn't need to: a stockpile piled too high on one side heels the raft, a tower built from an untested material cracks, and the volcano's swells find every weakness. Measuring is how you stop that from happening.

New kinds of block arrive when the world gives you a reason for them:

| When | You get |
|---|---|
| your first haul comes aboard | the Stockpile, Float and Frame |
| your first unknown sample comes aboard | the notebook, the test-cube throw and the density lens |
| something you want is out of reach, or you've hauled a few loads | the Crane |
| a keel (or a chunk hauled up from the deep) touches the fuel layer | the Pump |
| a tower breaks into the oxidiser sky | the Condenser |
| the first joint cracks, or you start pumping | the Smelter and the alloy table |
| you have both fuel and oxidiser | the Refinery |
| you have propellant | the rocket parts and the launch forecast |

## How it plays

- **Floating is physics.** Each block displaces fluid in every layer it touches (Archimedes, per block, per layer). Rafts heel and roll in the swell, and tall towers capsize light rafts. A heavy keel stabilises you, while a buoyant keel tries to flip you.
- **Load is physics too.** Weight is routed through welded joints to whatever holds it up, using a graph-Laplacian load-path solver. That includes the cargo resting on a block and the people standing on it. Joints carry vertical load well and sideways load poorly. Overloaded joints creak, crack, glow and snap, and the pieces fall into the sea. Ductile materials warn you early; brittle ones barely warn at all.
- **The sea is a place.** Row east or west to other sites. The anchor holds you; raise it and you drift with the current. Floating debris slides past the hull instead of piling up on the bow.
- **You only know what you've seen happen.** There is no lab and no datasheet. The notebook keeps each property as an interval, and hovering a property lists the experiments behind it. You narrow it with physical experiments, each with its own costs and noise:
  - **Throw a test cube.** A colonist carries a cube of the material to the edge and throws it. It shows where the material settles between the liquids, and how deep it floats (a cube floating at an interface is a hydrometer). It also shows what it does in every layer it sinks through.
  - **Weigh on the deck.** Everything you add pushes the raft down, so the raft is a scale. Weigh several blocks of one material at once, in calm water. Put two unknowns on together and you can't tell which weighs what. A known material on the scale with an unknown one still works.
  - **Load joints.** Joints that hold set a floor on strength; joints that crack or snap set a ceiling. Dense blocks stacked on a test joint load it fastest.
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
| Click flotsam, a wreck or a castaway | someone casts a line for it |
| Click a colonist | select them; click the deck to send them there |
| Click the lander core | row west / east, raise or drop the anchor |
| Click a block or an item on deck | its options (stow, throw overboard, patch...) |
| <kbd>1</kbd>–<kbd>0</kbd>, <kbd>T</kbd>, <kbd>C</kbd> | plan a block |
| <kbd>Q</kbd> / <kbd>E</kbd> | cycle material |
| Click / drag | place plans |
| Right-click | dismantle a block, cancel a plan |
| <kbd>G</kbd>, then click open water | throw a test cube |
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
- `src/sim/` is the simulation: planet generation, sea and waves, buoyancy, structures, the stress solver, knowledge, flotsam and fishing lines, colonists and their jobs, cargo and construction, the world's sites and castaways, experiments, the rocket and the volcano. It runs headless in Node.
- `src/render/` is the renderer: the density-field shader, material textures, colonists and particles.
- `src/ui.js` and `src/main.js` are the HUD, notebook, input and game loop.
- `src/audio.js` is the synthesised sound.

## Deploying

The project is a zero-config Vite static site (`vercel.json` included). Import the repository at [vercel.com/new](https://vercel.com/new) and every push deploys.

To deploy from the CLI instead:

```bash
npx vercel --prod
```
