# Wildbound

A small, original creature-battling roguelike built for the browser. Build a party from nineteen original creatures across Common, Rare, and Legendary tiers, survive 100 waves, then keep going in endless mode.

## Run locally

```sh
npm install
npm run dev
```

## How to play

- Each creature has its own starting moves and learns new moves at levels 5 and 7, up to four moves.
- Moves list their type, power, energy cost, and limited uses. Energy starts at zero; free moves charge one point, so 3-energy Ultimates unlock after three free moves.
- Buy or find a Move Tonic to restore all move uses for your active companion.
- **Fire beats Grass, Grass beats Water, and Water beats Fire.** Advantage deals 1.5× damage; disadvantage deals 0.75×.
- Wins award 35 XP; every 50 XP levels up the active companion. Monsters evolve at level 5, grow larger, and learn a unique signature move; Growth Candy can trigger evolution.
- Build a six-monster party, switch the active companion, and release captured monsters from the party menu.
- Buy Swift Catchers for +18% capture odds or Master Catchers for +35%; the best owned catcher is used automatically.
- Every wild encounter rolls 75% Common, 24% Rare, and 1% Legendary. Legendary monsters cannot evolve.
- Higher tiers have stronger stats, are harder to capture, and award better coins and item drops.
- Ten biomes rotate every five waves, with distinct arena palettes.
- Clear encounters to earn coins and experience; spend coins on potions, revives, and Growth Candy in Supplies.
- Defeated monsters can drop supplies; bosses always drop one.
- Reach wave 100 to unlock endless mode. The whole party heals after every five waves.
