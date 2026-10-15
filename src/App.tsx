import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  CircleDot,
  Download,
  Flame,
  Heart,
  HeartPulse,
  Leaf,
  Map,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  Save,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  Upload,
  X,
  Waves,
} from 'lucide-react'
import './App.css'

type Encounter = {
  name: string
  species: string
  title: string
  element: ElementType
  color: string
  accent: string
  attack: number
  tier: MonsterTier
  boss?: boolean
}

type ElementType = 'FIRE' | 'WATER' | 'GRASS' | 'ROCK' | 'ICE'
type MonsterTier = 'COMMON' | 'RARE' | 'LEGENDARY'
type Biome = { id: string; name: string; spawns: Record<MonsterTier, string[]> }
type Move = { id: string; name: string; type: ElementType; power: number; energyCost: number; uses: number; maxUses: number }
type CapturedCreature = Encounter & { id: string; level: number; lineage: string; moves: Move[] }
type PartyMember = Pick<CapturedCreature, 'id' | 'name' | 'species' | 'title' | 'element' | 'color' | 'accent' | 'tier' | 'level' | 'lineage' | 'moves'>
type EvolutionForm = Pick<Encounter, 'name' | 'species' | 'title' | 'element' | 'color' | 'accent'> & { requiredLevel: number }
type BattlePhase = 'battle' | 'won' | 'caught' | 'lost' | 'endless'
type Action = 'capture' | 'switch'
type Supply = 'potion' | 'revive' | 'candy' | 'tonic'
type CatcherType = 'trail' | 'swift' | 'master'
type GameSave = {
  version: 1
  stage: number
  partyHp: Record<string, number>
  enemy: Encounter & { maxHp: number }
  enemyHp: number
  energy: number
  experience: number
  starter: PartyMember
  coins: number
  inventory: Record<Supply, number>
  catchers: Record<CatcherType, number>
  captured: CapturedCreature[]
  activeCompanionId: string
  captureSequence: number
  phase: BattlePhase
  log: string[]
}

const SAVE_STORAGE_KEY = 'wildbound-save-v1'

function isGameSave(value: unknown): value is GameSave {
  if (!value || typeof value !== 'object') return false
  const save = value as Partial<GameSave>
  return save.version === 1
    && Number.isInteger(save.stage) && (save.stage ?? 0) >= 1
    && !!save.enemy && typeof save.enemy === 'object' && typeof save.enemy.name === 'string'
    && typeof save.enemyHp === 'number' && save.enemyHp >= 0
    && typeof save.partyHp === 'object' && save.partyHp !== null
    && typeof save.starter === 'object' && save.starter !== null
    && Array.isArray(save.captured)
    && typeof save.inventory === 'object' && save.inventory !== null
    && typeof save.catchers === 'object' && save.catchers !== null
    && typeof save.activeCompanionId === 'string'
    && typeof save.captureSequence === 'number'
    && ['battle', 'won', 'caught', 'lost', 'endless'].includes(save.phase ?? '')
    && Array.isArray(save.log)
}

function readBrowserSave(): GameSave | null {
  try {
    const serialized = window.localStorage.getItem(SAVE_STORAGE_KEY)
    if (!serialized) return null
    const value: unknown = JSON.parse(serialized)
    return isGameSave(value) ? value : null
  } catch {
    return null
  }
}

const EXPERIENCE_TO_LEVEL = 50
const EXPERIENCE_PER_WIN = 35
const MAX_WAVES = 100
const MAX_PARTY_SIZE = 6

const supplyCatalog: { id: Supply; name: string; description: string; price: number }[] = [
  { id: 'potion', name: 'Trail Potion', description: 'Restore 35 HP to your active companion.', price: 10 },
  { id: 'revive', name: 'Revive Bloom', description: 'Bring one fainted companion back with 42 HP.', price: 18 },
  { id: 'candy', name: 'Growth Candy', description: 'Level up your active companion; may trigger evolution.', price: 24 },
  { id: 'tonic', name: 'Move Tonic', description: 'Restore all moves for your active companion.', price: 16 },
]

const catcherCatalog: { id: CatcherType; name: string; description: string; price: number; bonus: number }[] = [
  { id: 'trail', name: 'Trail Pod', description: 'Standard wild catcher.', price: 0, bonus: 0 },
  { id: 'swift', name: 'Swift Pod', description: '+18% capture chance.', price: 28, bonus: 18 },
  { id: 'master', name: 'Master Pod', description: '+35% capture chance.', price: 70, bonus: 35 },
]

function rollChance(percent: number) {
  return Math.random() * 100 < percent
}

function rollMonsterDrop(tier: MonsterTier, isBoss: boolean): Supply | null {
  const dropChance = tier === 'COMMON' ? 45 : tier === 'RARE' ? 70 : 90
  if (!isBoss && !rollChance(dropChance)) return null
  const lootTable: Supply[] = isBoss
    ? ['potion', 'revive', 'candy', 'tonic']
    : ['potion', 'potion', 'potion', 'revive', 'candy', 'tonic']
  return lootTable[Math.floor(Math.random() * lootTable.length)]
}

const elementAdvantage: Record<ElementType, ElementType[]> = {
  FIRE: ['GRASS', 'ICE'],
  WATER: ['FIRE', 'ROCK'],
  GRASS: ['WATER', 'ROCK'],
  ROCK: ['FIRE', 'ICE'],
  ICE: ['GRASS', 'WATER'],
}

function typeMultiplier(attacker: ElementType, defender: ElementType) {
  if (elementAdvantage[attacker].includes(defender)) return 1.5
  if (elementAdvantage[defender].includes(attacker)) return 0.75
  return 1
}

function typeEffectivenessNote(multiplier: number) {
  if (multiplier > 1) return ' Super effective!'
  if (multiplier < 1) return ' Not very effective.'
  return ''
}

function damageFromType(baseDamage: number, attacker: ElementType, defender: ElementType, reduction = 0) {
  return Math.max(3, Math.round(baseDamage * typeMultiplier(attacker, defender)) - reduction)
}

const bestiary: Encounter[] = [
  { name: 'Mossback', species: 'Thicket grazer', title: 'The quiet wall', element: 'GRASS', color: '#76915a', accent: '#d9df8d', attack: 8, tier: 'COMMON' },
  { name: 'Glimmerwing', species: 'Lantern moth', title: 'Keeper of dusk', element: 'FIRE', color: '#ce8461', accent: '#f2d78c', attack: 10, tier: 'COMMON' },
  { name: 'Bramble Crown', species: 'Old-growth guardian', title: 'Root of the wilds', element: 'GRASS', color: '#6b7f4b', accent: '#e7ad71', attack: 12, tier: 'RARE', boss: true },
  { name: 'Cinderkin', species: 'Ashland prowler', title: 'Born from embers', element: 'FIRE', color: '#ca6e52', accent: '#f2bb70', attack: 13, tier: 'COMMON' },
  { name: 'Tideglass', species: 'Shoreline spirit', title: 'The blue hour', element: 'WATER', color: '#648d8a', accent: '#c7e3ce', attack: 14, tier: 'RARE', boss: true },
  { name: 'Cloudhorn', species: 'Skyland ram', title: 'Keeper of high winds', element: 'WATER', color: '#789cab', accent: '#dbe8dc', attack: 12, tier: 'COMMON' },
  { name: 'Quartzle', species: 'Crystal burrower', title: 'The deep glint', element: 'GRASS', color: '#897f9f', accent: '#d9d3b6', attack: 13, tier: 'COMMON' },
  { name: 'Duskmallow', species: 'Twilight hopper', title: 'Last light keeper', element: 'WATER', color: '#827391', accent: '#d3a1b6', attack: 14, tier: 'RARE' },
  { name: 'Petalisk', species: 'Blossom drake', title: 'Springtide wonder', element: 'GRASS', color: '#b87c83', accent: '#efcb8a', attack: 15, tier: 'LEGENDARY' },
  { name: 'Starcoil', species: 'Meteor serpent', title: 'Crown of the firmament', element: 'FIRE', color: '#5c778e', accent: '#e4c77c', attack: 18, tier: 'LEGENDARY', boss: true },
  { name: 'Shellbit', species: 'Tidepool turtle', title: 'The little shelter', element: 'WATER', color: '#6d98a0', accent: '#d4e4c7', attack: 9, tier: 'COMMON' },
  { name: 'Bristleaf', species: 'Bramble hedgehog', title: 'The seed keeper', element: 'GRASS', color: '#7e965e', accent: '#f0c98c', attack: 9, tier: 'COMMON' },
  { name: 'Emberling', species: 'Cinder salamander', title: 'A pocket-sized spark', element: 'FIRE', color: '#cf7452', accent: '#f3ca72', attack: 10, tier: 'COMMON' },
  { name: 'Mistray', species: 'Cloud manta', title: 'The drifting veil', element: 'WATER', color: '#688da5', accent: '#d5e8e6', attack: 14, tier: 'RARE' },
  { name: 'Rootusk', species: 'Mossback boar', title: 'The hill guardian', element: 'GRASS', color: '#718453', accent: '#e0be76', attack: 14, tier: 'RARE' },
  { name: 'Pyrelynx', species: 'Suncinder cat', title: 'The scarlet pouncer', element: 'FIRE', color: '#bb5d45', accent: '#f5be68', attack: 15, tier: 'RARE' },
  { name: 'Auroray', species: 'Polar skywhale', title: 'The northern light', element: 'WATER', color: '#638c9b', accent: '#e3dafa', attack: 20, tier: 'LEGENDARY', boss: true },
  { name: 'Verdant Wyrm', species: 'Worldroot dragon', title: 'The ancient canopy', element: 'GRASS', color: '#567754', accent: '#e1d082', attack: 21, tier: 'LEGENDARY', boss: true },
  { name: 'Caldera Crown', species: 'Volcanic colossus', title: 'The sleeping mountain', element: 'FIRE', color: '#9e4f43', accent: '#f1bd69', attack: 22, tier: 'LEGENDARY', boss: true },
  { name: 'Pebblit', species: 'Granite pup', title: 'The rolling pebble', element: 'ROCK', color: '#958878', accent: '#d9c9a9', attack: 9, tier: 'COMMON' },
  { name: 'Snowkit', species: 'Frost fox', title: 'The first flurry', element: 'ICE', color: '#83abb9', accent: '#e3f1e8', attack: 10, tier: 'COMMON' },
  { name: 'Geodrake', species: 'Crystal burrower', title: 'The cave guardian', element: 'ROCK', color: '#81788f', accent: '#d8c99e', attack: 15, tier: 'RARE' },
  { name: 'Frostfang', species: 'Glacier wolf', title: 'The white hunter', element: 'ICE', color: '#668ca7', accent: '#d6eff1', attack: 15, tier: 'RARE' },
  { name: 'Obsidian Colossus', species: 'Volcanic titan', title: 'The buried mountain', element: 'ROCK', color: '#625c68', accent: '#d9a96b', attack: 22, tier: 'LEGENDARY', boss: true },
  { name: 'Borealis Queen', species: 'Aurora dragon', title: 'Winter’s crown', element: 'ICE', color: '#648b9d', accent: '#eadcf0', attack: 23, tier: 'LEGENDARY', boss: true },
]

const biomes: Biome[] = [
  { id: 'fernwake', name: 'FERNWAKE PATH', spawns: { COMMON: ['Mossback', 'Bristleaf'], RARE: ['Bramble Crown', 'Rootusk'], LEGENDARY: ['Verdant Wyrm'] } },
  { id: 'sunmeadow', name: 'SUNMEADOW', spawns: { COMMON: ['Glimmerwing'], RARE: ['Pyrelynx'], LEGENDARY: ['Petalisk'] } },
  { id: 'mistmarsh', name: 'MISTFALL MARSH', spawns: { COMMON: ['Shellbit'], RARE: ['Mistray'], LEGENDARY: ['Auroray'] } },
  { id: 'emberwood', name: 'EMBERWOOD', spawns: { COMMON: ['Cinderkin', 'Emberling'], RARE: ['Pyrelynx'], LEGENDARY: ['Caldera Crown'] } },
  { id: 'pearlcoast', name: 'PEARL COAST', spawns: { COMMON: ['Cloudhorn', 'Shellbit'], RARE: ['Tideglass'], LEGENDARY: ['Auroray'] } },
  { id: 'moonpetal', name: 'MOONPETAL GLEN', spawns: { COMMON: ['Glimmerwing', 'Bristleaf'], RARE: ['Duskmallow'], LEGENDARY: ['Petalisk'] } },
  { id: 'frostfern', name: 'FROSTFERN TUNDRA', spawns: { COMMON: ['Cloudhorn', 'Snowkit'], RARE: ['Mistray', 'Tideglass', 'Frostfang'], LEGENDARY: ['Auroray', 'Borealis Queen'] } },
  { id: 'cragrock', name: 'CRAGROCK RIDGE', spawns: { COMMON: ['Quartzle', 'Pebblit'], RARE: ['Rootusk', 'Geodrake'], LEGENDARY: ['Verdant Wyrm', 'Obsidian Colossus'] } },
  { id: 'wildflower', name: 'WILDFLOWER RISE', spawns: { COMMON: ['Bristleaf', 'Mossback'], RARE: ['Duskmallow'], LEGENDARY: ['Petalisk'] } },
  { id: 'starfall', name: 'STARFALL SUMMIT', spawns: { COMMON: ['Emberling'], RARE: ['Bramble Crown', 'Pyrelynx'], LEGENDARY: ['Starcoil'] } },
]

function biomeForStage(stage: number) {
  return biomes[Math.floor((stage - 1) / 5) % biomes.length]
}

const evolutionForms: Record<string, EvolutionForm> = {
  Pip: { name: 'Cinderskip', species: 'Ember fox', title: 'The bright spark', element: 'FIRE', color: '#d86843', accent: '#ffd27a', requiredLevel: 5 },
  Mossback: { name: 'Ironbark', species: 'Ancient grazer', title: 'The grove stands tall', element: 'GRASS', color: '#607d4d', accent: '#c8da7b', requiredLevel: 5 },
  Glimmerwing: { name: 'Dawnwing', species: 'Sunrise moth', title: 'First light keeper', element: 'FIRE', color: '#d58b52', accent: '#ffe08b', requiredLevel: 5 },
  'Bramble Crown': { name: 'Elder Crown', species: 'Forest sovereign', title: 'Root of the old world', element: 'GRASS', color: '#566f43', accent: '#e4bd73', requiredLevel: 5 },
  Cinderkin: { name: 'Ashmane', species: 'Cinder lion', title: 'Heart of the furnace', element: 'FIRE', color: '#bd5f45', accent: '#ffd078', requiredLevel: 5 },
  Tideglass: { name: 'Mooncurrent', species: 'Tidal spirit', title: 'The silver deep', element: 'WATER', color: '#527d82', accent: '#c5e7dc', requiredLevel: 5 },
  Cloudhorn: { name: 'Stormram', species: 'Thunder ram', title: 'Rider of the squall', element: 'WATER', color: '#5d8199', accent: '#d7e8d2', requiredLevel: 5 },
  Quartzle: { name: 'Prismole', species: 'Crystal keeper', title: 'The green-glass heart', element: 'GRASS', color: '#777494', accent: '#e4d9a9', requiredLevel: 5 },
  Duskmallow: { name: 'Nightbloom', species: 'Moonlit hopper', title: 'Dream of the marsh', element: 'WATER', color: '#766184', accent: '#e4abc5', requiredLevel: 5 },
  Shellbit: { name: 'Tideshell', species: 'Reefback turtle', title: 'Keeper of quiet coves', element: 'WATER', color: '#4e858d', accent: '#b7dec8', requiredLevel: 5 },
  Bristleaf: { name: 'Thornhog', species: 'Brambleback guardian', title: 'The hedge stands firm', element: 'GRASS', color: '#637d4d', accent: '#e6c477', requiredLevel: 5 },
  Emberling: { name: 'Pyrelisk', species: 'Furnace salamander', title: 'The hearth awakened', element: 'FIRE', color: '#bd5945', accent: '#ffd275', requiredLevel: 5 },
  Mistray: { name: 'Veilwhale', species: 'Mistborne leviathan', title: 'The hidden current', element: 'WATER', color: '#527d91', accent: '#d7e8e7', requiredLevel: 5 },
  Rootusk: { name: 'Grovehorn', species: 'Forest tusker', title: 'The old hill stirs', element: 'GRASS', color: '#5c7244', accent: '#d9bc76', requiredLevel: 5 },
  Pyrelynx: { name: 'Solpouncer', species: 'Sunmane hunter', title: 'The noonfire stalker', element: 'FIRE', color: '#a94f3d', accent: '#f4ca72', requiredLevel: 5 },
}
const evolvedCreatureNames = new Set(Object.values(evolutionForms).map((form) => form.name))

function makeMove(id: string, name: string, type: ElementType, power: number, energyCost: number): Move {
  const maxUses = energyCost === 0 ? 12 : energyCost === 1 ? 10 : energyCost === 2 ? 7 : 5
  return { id, name, type, power, energyCost, uses: maxUses, maxUses }
}

const evolutionSignatureMoves: Record<string, Move> = {
  Cinderskip: makeMove('phoenix-pounce', 'Phoenix Pounce', 'FIRE', 40, 3),
  Ironbark: makeMove('ironroot-slam', 'Ironroot Slam', 'GRASS', 40, 3),
  Dawnwing: makeMove('aurora-flare', 'Aurora Flare', 'FIRE', 40, 3),
  'Elder Crown': makeMove('verdant-crown', 'Verdant Crown', 'GRASS', 42, 3),
  Ashmane: makeMove('royal-inferno', 'Royal Inferno', 'FIRE', 42, 3),
  Mooncurrent: makeMove('moonfall-wave', 'Moonfall Wave', 'WATER', 42, 3),
  Stormram: makeMove('tempest-ram', 'Tempest Ram', 'WATER', 42, 3),
  Prismole: makeMove('prism-burst', 'Prism Burst', 'GRASS', 40, 3),
  Nightbloom: makeMove('dream-tide', 'Dream Tide', 'WATER', 40, 3),
  Tideshell: makeMove('reef-guard', 'Reef Guard', 'WATER', 42, 3),
  Thornhog: makeMove('briar-wheel', 'Briar Wheel', 'GRASS', 42, 3),
  Pyrelisk: makeMove('furnace-tail', 'Furnace Tail', 'FIRE', 42, 3),
  Veilwhale: makeMove('veilbreaker', 'Veilbreaker', 'WATER', 44, 3),
  Grovehorn: makeMove('ancient-stampede', 'Ancient Stampede', 'GRASS', 44, 3),
  Solpouncer: makeMove('sunfire-chase', 'Sunfire Chase', 'FIRE', 44, 3),
}

const startingMoveSets: Record<string, Move[]> = {
  Pip: [makeMove('ember-nip', 'Ember Nip', 'FIRE', 13, 0), makeMove('tail-spark', 'Tail Spark', 'FIRE', 18, 1)],
  Mossback: [makeMove('acorn-bonk', 'Acorn Bonk', 'GRASS', 13, 0), makeMove('vine-snare', 'Vine Snare', 'GRASS', 18, 1)],
  Glimmerwing: [makeMove('flicker-dust', 'Flicker Dust', 'FIRE', 12, 0), makeMove('lamp-lash', 'Lamp Lash', 'FIRE', 19, 1)],
  'Bramble Crown': [makeMove('briar-jab', 'Briar Jab', 'GRASS', 14, 0), makeMove('crown-sweep', 'Crown Sweep', 'GRASS', 20, 1)],
  Cinderkin: [makeMove('coal-pounce', 'Coal Pounce', 'FIRE', 14, 0), makeMove('soot-claw', 'Soot Claw', 'FIRE', 20, 1)],
  Tideglass: [makeMove('glass-current', 'Glass Current', 'WATER', 13, 0), makeMove('ripple-cut', 'Ripple Cut', 'WATER', 19, 1)],
  Cloudhorn: [makeMove('cloud-ram', 'Cloud Ram', 'WATER', 14, 0), makeMove('rain-charge', 'Rain Charge', 'WATER', 20, 1)],
  Quartzle: [makeMove('crystal-peck', 'Crystal Peck', 'GRASS', 13, 0), makeMove('quartz-roll', 'Quartz Roll', 'GRASS', 19, 1)],
  Duskmallow: [makeMove('dusk-drip', 'Dusk Drip', 'WATER', 13, 0), makeMove('marsh-hop', 'Marsh Hop', 'WATER', 19, 1)],
  Petalisk: [makeMove('petal-flick', 'Petal Flick', 'GRASS', 13, 0), makeMove('thorn-dance', 'Thorn Dance', 'GRASS', 19, 1)],
  Starcoil: [makeMove('star-spark', 'Star Spark', 'FIRE', 15, 0), makeMove('comet-coil', 'Comet Coil', 'FIRE', 21, 1)],
  Shellbit: [makeMove('shell-bop', 'Shell Bop', 'WATER', 13, 0), makeMove('splash-tumble', 'Splash Tumble', 'WATER', 18, 1)],
  Bristleaf: [makeMove('burr-bump', 'Burr Bump', 'GRASS', 13, 0), makeMove('leaf-puff', 'Leaf Puff', 'GRASS', 18, 1)],
  Emberling: [makeMove('warm-nip', 'Warm Nip', 'FIRE', 13, 0), makeMove('spark-skip', 'Spark Skip', 'FIRE', 19, 1)],
  Mistray: [makeMove('fog-flutter', 'Fog Flutter', 'WATER', 18, 0), makeMove('silver-swell', 'Silver Swell', 'WATER', 23, 1)],
  Rootusk: [makeMove('moss-mallet', 'Moss Mallet', 'GRASS', 18, 0), makeMove('hill-roll', 'Hill Roll', 'GRASS', 23, 1)],
  Pyrelynx: [makeMove('sun-pounce', 'Sun Pounce', 'FIRE', 19, 0), makeMove('flare-claw', 'Flare Claw', 'FIRE', 24, 1)],
  Auroray: [makeMove('halo-current', 'Halo Current', 'WATER', 24, 0), makeMove('northern-surge', 'Northern Surge', 'WATER', 32, 2)],
  'Verdant Wyrm': [makeMove('barkscale', 'Barkscale', 'GRASS', 25, 0), makeMove('green-comet', 'Green Comet', 'GRASS', 33, 2)],
  'Caldera Crown': [makeMove('magma-arc', 'Magma Arc', 'FIRE', 26, 0), makeMove('volcanic-core', 'Volcanic Core', 'FIRE', 34, 2)],
}

const learnableMoveSets: Record<string, { level: number; move: Move }[]> = {
  Pip: [{ level: 5, move: makeMove('flare-leap', 'Flare Leap', 'FIRE', 25, 2) }, { level: 7, move: makeMove('solar-burst', 'Solar Burst', 'FIRE', 32, 3) }],
  Mossback: [{ level: 5, move: makeMove('canopy-crush', 'Canopy Crush', 'GRASS', 25, 2) }, { level: 7, move: makeMove('root-quake', 'Root Quake', 'GRASS', 32, 3) }],
  Glimmerwing: [{ level: 5, move: makeMove('dawn-flash', 'Dawn Flash', 'FIRE', 25, 2) }, { level: 7, move: makeMove('solstice-wing', 'Solstice Wing', 'FIRE', 32, 3) }],
  'Bramble Crown': [{ level: 5, move: makeMove('elder-thorns', 'Elder Thorns', 'GRASS', 27, 2) }, { level: 7, move: makeMove('worldroot', 'Worldroot', 'GRASS', 34, 3) }],
  Cinderkin: [{ level: 5, move: makeMove('cinder-rush', 'Cinder Rush', 'FIRE', 26, 2) }, { level: 7, move: makeMove('ashfall', 'Ashfall', 'FIRE', 34, 3) }],
  Tideglass: [{ level: 5, move: makeMove('moon-tide', 'Moon Tide', 'WATER', 26, 2) }, { level: 7, move: makeMove('deep-surge', 'Deep Surge', 'WATER', 33, 3) }],
  Cloudhorn: [{ level: 5, move: makeMove('squall-horn', 'Squall Horn', 'WATER', 27, 2) }, { level: 7, move: makeMove('tempest-arc', 'Tempest Arc', 'WATER', 34, 3) }],
  Quartzle: [{ level: 5, move: makeMove('shard-bloom', 'Shard Bloom', 'GRASS', 26, 2) }, { level: 7, move: makeMove('emerald-fault', 'Emerald Fault', 'GRASS', 33, 3) }],
  Duskmallow: [{ level: 5, move: makeMove('night-current', 'Night Current', 'WATER', 26, 2) }, { level: 7, move: makeMove('moonbog', 'Moonbog', 'WATER', 33, 3) }],
  Petalisk: [{ level: 5, move: makeMove('bloom-burst', 'Bloom Burst', 'GRASS', 26, 2) }, { level: 7, move: makeMove('garden-storm', 'Garden Storm', 'GRASS', 33, 3) }],
  Starcoil: [{ level: 5, move: makeMove('meteor-arc', 'Meteor Arc', 'FIRE', 28, 2) }, { level: 7, move: makeMove('supernova', 'Supernova', 'FIRE', 36, 3) }],
  Shellbit: [{ level: 5, move: makeMove('shellguard', 'Shellguard', 'WATER', 25, 2) }, { level: 7, move: makeMove('tidal-pinball', 'Tidal Pinball', 'WATER', 32, 3) }],
  Bristleaf: [{ level: 5, move: makeMove('seed-volley', 'Seed Volley', 'GRASS', 25, 2) }, { level: 7, move: makeMove('burricane', 'Burricane', 'GRASS', 32, 3) }],
  Emberling: [{ level: 5, move: makeMove('torchskip', 'Torchskip', 'FIRE', 25, 2) }, { level: 7, move: makeMove('cinder-cone', 'Cinder Cone', 'FIRE', 32, 3) }],
  Mistray: [{ level: 5, move: makeMove('mist-waltz', 'Mist Waltz', 'WATER', 29, 2) }, { level: 7, move: makeMove('undertow-song', 'Undertow Song', 'WATER', 36, 3) }],
  Rootusk: [{ level: 5, move: makeMove('moss-quake', 'Moss Quake', 'GRASS', 29, 2) }, { level: 7, move: makeMove('highland-charge', 'Highland Charge', 'GRASS', 36, 3) }],
  Pyrelynx: [{ level: 5, move: makeMove('blazestep', 'Blazestep', 'FIRE', 30, 2) }, { level: 7, move: makeMove('solar-claw', 'Solar Claw', 'FIRE', 37, 3) }],
  Auroray: [{ level: 5, move: makeMove('aurora-drift', 'Aurora Drift', 'WATER', 35, 2) }, { level: 7, move: makeMove('polar-crown', 'Polar Crown', 'WATER', 42, 3) }],
  'Verdant Wyrm': [{ level: 5, move: makeMove('canopy-fall', 'Canopy Fall', 'GRASS', 36, 2) }, { level: 7, move: makeMove('worldroot-call', 'Worldroot Call', 'GRASS', 43, 3) }],
  'Caldera Crown': [{ level: 5, move: makeMove('magma-tide', 'Magma Tide', 'FIRE', 37, 2) }, { level: 7, move: makeMove('mountain-heart', 'Mountain Heart', 'FIRE', 44, 3) }],
}

function movesForLevel(lineage: string, level: number) {
  const startingMoves = startingMoveSets[lineage] ?? []
  const learnedMoves = (learnableMoveSets[lineage] ?? []).filter((entry) => entry.level <= level).map((entry) => entry.move)
  return [...startingMoves, ...learnedMoves].slice(-4)
}

const starterBase: PartyMember = {
  id: 'pip', name: 'Pip', species: 'Spark fox', title: 'The little spark', element: 'FIRE', color: '#dc8055', accent: '#f2bd68',
  level: 3, lineage: 'Pip', moves: movesForLevel('Pip', 3), tier: 'COMMON',
}

function evolveIfEligible(member: PartyMember): PartyMember {
  if (member.tier === 'LEGENDARY') return member
  const evolution = evolutionForms[member.name]
  if (!evolution || member.level < evolution.requiredLevel) return member
  return {
    ...member,
    name: evolution.name,
    species: evolution.species,
    title: evolution.title,
    element: evolution.element,
    color: evolution.color,
    accent: evolution.accent,
    tier: member.tier === 'COMMON' ? 'RARE' : 'LEGENDARY',
  }
}

function evolveWithSignature(member: PartyMember): PartyMember {
  const evolved = evolveIfEligible(member)
  if (evolved.name === member.name) return evolved
  const signatureMove = evolutionSignatureMoves[evolved.name]
  if (!signatureMove) return evolved
  return { ...evolved, moves: [...evolved.moves.slice(-3), signatureMove] }
}

function encounterFor(stage: number): Encounter & { maxHp: number } {
  const biome = biomeForStage(stage)
  const tierRoll = Math.random() * 100
  const tier: MonsterTier = tierRoll < 75 ? 'COMMON' : tierRoll < 99 ? 'RARE' : 'LEGENDARY'
  const tierPool = bestiary.filter((monster) => monster.tier === tier && biome.spawns[tier].includes(monster.name))
  const base = tierPool[Math.floor(Math.random() * tierPool.length)]
  const cycle = Math.floor((stage - 1) / bestiary.length)
  const tierScale = base.tier === 'COMMON' ? { health: 1, attack: 1 } : base.tier === 'RARE' ? { health: 1.25, attack: 1.15 } : { health: 1.6, attack: 1.35 }
  return {
    ...base,
    maxHp: Math.round((48 + stage * 7) * tierScale.health),
    attack: Math.round((base.attack + cycle * 3) * tierScale.attack),
  }
}

function CreatureArt({ enemy, color, accent, name }: { enemy?: boolean; color: string; accent: string; name?: string }) {
  const evolved = name ? evolvedCreatureNames.has(name) : false
  if (enemy) {
    return (
      <svg className="creature-art enemy-art" viewBox="0 0 240 210" role="img" aria-label="A wild creature">
        <ellipse cx="120" cy="191" rx="83" ry="12" fill="#263b31" opacity=".14" />
        <path d="M58 140c-12-26 2-65 28-80 13-8 28-9 40-3 17-14 48-8 59 12 7 13 8 31 3 48l14 28c4 9-2 19-12 19h-22c-7 14-22 23-42 23H94c-21 0-33-16-36-47Z" fill={color} stroke="#34493d" strokeWidth="5" strokeLinejoin="round" />
        <path d="M77 89c9-26 31-42 52-39 7 1 11 8 8 14-9 17-27 28-52 33-7 1-11-2-8-8Z" fill={accent} stroke="#34493d" strokeWidth="4" />
        <path d="M114 69c1-19 15-36 34-39 9-1 14 7 9 15-8 12-21 22-39 31" fill={accent} stroke="#34493d" strokeWidth="4" strokeLinejoin="round" />
        <path d="M153 68c8-17 25-25 40-19 7 3 8 12 1 17l-27 17" fill={accent} stroke="#34493d" strokeWidth="4" strokeLinejoin="round" />
        <path d="M83 145c14-12 34-16 52-10 12 4 18 17 12 28-5 10-17 15-31 15H99c-16 0-25-22-16-33Z" fill="#efead6" stroke="#34493d" strokeWidth="4" />
        <ellipse cx="158" cy="120" rx="5" ry="7" fill="#273d35" />
        <circle cx="159" cy="118" r="1.6" fill="#fff8e8" />
        <ellipse cx="143" cy="133" rx="6" ry="3.5" fill="#e99591" opacity=".72" />
        <path d="M166 135c8 2 14 0 18-4" fill="none" stroke="#34493d" strokeWidth="3" strokeLinecap="round" />
        <path d="M56 145c-15-7-22-19-20-35 2-10 11-14 18-7l12 14" fill={color} stroke="#34493d" strokeWidth="4" strokeLinecap="round" />
        <path d="M94 169v13m48-8 3 10" stroke="#34493d" strokeWidth="6" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg className={`creature-art player-art ${evolved ? 'is-evolved' : ''}`} viewBox="0 0 220 190" role="img" aria-label={`Your companion, ${name ?? 'Pip'}`}>
      <ellipse cx="109" cy="173" rx="66" ry="9" fill="#263b31" opacity=".13" />
      <path d="M53 130c-9-30 7-61 31-72 13-6 30-3 39 7 16-7 37 0 44 18 7 17 4 41-7 55-8 10-23 17-41 17H83c-15 0-25-9-30-25Z" fill={color} stroke="#4c4939" strokeWidth="5" strokeLinejoin="round" />
      <path d="M80 69 67 38c-3-8 4-14 12-10l33 19" fill={accent} stroke="#4c4939" strokeWidth="5" strokeLinejoin="round" />
      <path d="M137 65 158 39c5-7 14-4 14 4l-3 36" fill={accent} stroke="#4c4939" strokeWidth="5" strokeLinejoin="round" />
      <path d="M79 123c13-10 35-11 49-4 11 6 10 22-1 27-14 6-35 5-48-2-8-5-8-15 0-21Z" fill="#f2e9cc" />
      <circle cx="91" cy="101" r="4" fill="#303d35" />
      <circle cx="139" cy="101" r="4" fill="#303d35" />
      <circle cx="90" cy="100" r="1.5" fill="#fff8e8" />
      <circle cx="138" cy="100" r="1.5" fill="#fff8e8" />
      <ellipse cx="78" cy="111" rx="7" ry="4" fill="#e99591" opacity=".78" />
      <ellipse cx="151" cy="111" rx="7" ry="4" fill="#e99591" opacity=".78" />
      <path d="M108 115c4 4 9 4 13 0" fill="none" stroke="#4c4939" strokeWidth="3" strokeLinecap="round" />
      <path d="M55 128c-16 2-26 12-26 25 0 8 7 12 13 7l16-14" fill={color} stroke="#4c4939" strokeWidth="4" strokeLinecap="round" />
      <path d="M87 151v12m43-12v12" stroke="#4c4939" strokeWidth="5" strokeLinecap="round" />
      <path d="m109 53 5-17 7 14 16-4-10 13" fill={accent} stroke="#4c4939" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

function App() {
  const [loadedSave] = useState<GameSave | null>(readBrowserSave)
  const captureSequence = useRef(loadedSave?.captureSequence ?? 0)
  const [stage, setStage] = useState(loadedSave?.stage ?? 1)
  const [partyHp, setPartyHp] = useState<Record<string, number>>(loadedSave?.partyHp ?? { pip: 84 })
  const [enemy, setEnemy] = useState(() => loadedSave?.enemy ?? encounterFor(1))
  const [enemyHp, setEnemyHp] = useState(() => loadedSave?.enemyHp ?? (loadedSave?.enemy ?? encounterFor(1)).maxHp)
  const [energy, setEnergy] = useState(loadedSave?.energy ?? 0)
  const [experience, setExperience] = useState(loadedSave?.experience ?? 28)
  const [starter, setStarter] = useState<PartyMember>(loadedSave?.starter ?? starterBase)
  const [coins, setCoins] = useState(loadedSave?.coins ?? 12)
  const [inventory, setInventory] = useState<Record<Supply, number>>(loadedSave?.inventory ?? { potion: 0, revive: 0, candy: 0, tonic: 0 })
  const [catchers, setCatchers] = useState<Record<CatcherType, number>>(loadedSave?.catchers ?? { trail: 3, swift: 0, master: 0 })
  const [captured, setCaptured] = useState<CapturedCreature[]>(loadedSave?.captured ?? [])
  const [activeCompanionId, setActiveCompanionId] = useState(loadedSave?.activeCompanionId ?? 'pip')
  const [partyOpen, setPartyOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const importSaveInput = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<BattlePhase>(loadedSave?.phase ?? 'battle')
  const [guideOpen, setGuideOpen] = useState(false)
  const [log, setLog] = useState<string[]>(loadedSave?.log ?? ['A wild creature blocks the trail.', 'Pip is ready. What will you do?'])

  useEffect(() => {
    const save: GameSave = {
      version: 1,
      stage,
      partyHp,
      enemy,
      enemyHp,
      energy,
      experience,
      starter,
      coins,
      inventory,
      catchers,
      captured,
      activeCompanionId,
      captureSequence: captureSequence.current,
      phase,
      log,
    }
    try {
      window.localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(save))
    } catch {
      setSaveNotice('Browser autosave is unavailable')
    }
  }, [stage, partyHp, enemy, enemyHp, energy, experience, starter, coins, inventory, catchers, captured, activeCompanionId, phase, log])

  const rarityPenalty = enemy.tier === 'RARE' ? 10 : enemy.tier === 'LEGENDARY' ? 20 : 0
  const activeCatcher = catchers.master > 0 ? catcherCatalog[2] : catchers.swift > 0 ? catcherCatalog[1] : catcherCatalog[0]
  const baseCaptureChance = Math.max(5, Math.min(90, Math.round(25 + (1 - enemyHp / enemy.maxHp) * 65 - (enemy.boss ? 10 : 0) - rarityPenalty)))
  const captureChance = Math.min(99, baseCaptureChance + activeCatcher.bonus)
  const party: PartyMember[] = [
    starter,
    ...captured,
  ]
  const activeCompanion = party.find((member) => member.id === activeCompanionId) ?? party[0]
  const playerHp = partyHp[activeCompanion.id] ?? 84
  const appendLog = (message: string) => setLog((entries) => [message, ...entries].slice(0, 4))
  const exportSave = () => {
    const save: GameSave = {
      version: 1,
      stage,
      partyHp,
      enemy,
      enemyHp,
      energy,
      experience,
      starter,
      coins,
      inventory,
      catchers,
      captured,
      activeCompanionId,
      captureSequence: captureSequence.current,
      phase,
      log,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `wildbound-wave-${stage}-save.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setSaveNotice(`Wave ${stage} save exported`)
    setSaveMenuOpen(false)
  }

  const importSave = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isGameSave(parsed)) throw new Error('Invalid save')
      captureSequence.current = parsed.captureSequence
      setStage(parsed.stage)
      setPartyHp(parsed.partyHp)
      setEnemy(parsed.enemy)
      setEnemyHp(parsed.enemyHp)
      setEnergy(parsed.energy)
      setExperience(parsed.experience)
      setStarter(parsed.starter)
      setCoins(parsed.coins)
      setInventory(parsed.inventory)
      setCatchers(parsed.catchers)
      setCaptured(parsed.captured)
      setActiveCompanionId(parsed.activeCompanionId)
      setPhase(parsed.phase)
      setLog(parsed.log)
      setSaveNotice(`Wave ${parsed.stage} save imported`)
      setSaveMenuOpen(false)
    } catch {
      setSaveNotice('Could not import that save file')
    } finally {
      event.currentTarget.value = ''
    }
  }
  const levelUpCompanion = (member: PartyMember) => {
    const nextLevel = member.level + 1
    const learnedMove = (learnableMoveSets[member.lineage] ?? []).find((entry) => entry.level === nextLevel)?.move
    const leveledMember = evolveWithSignature({
      ...member,
      level: nextLevel,
      moves: learnedMove ? [...member.moves, learnedMove].slice(-4) : member.moves,
    })
    const signatureMove = member.name !== leveledMember.name ? evolutionSignatureMoves[leveledMember.name] : undefined
    if (member.id === 'pip') {
      setStarter(leveledMember)
    } else {
      setCaptured((current) => current.map((candidate) => candidate.id === member.id ? { ...candidate, ...leveledMember } : candidate))
    }
    if (leveledMember.name !== member.name) appendLog(`${member.name} evolved into ${leveledMember.name}!`)
    else if (!learnedMove) appendLog(`${member.name} reached level ${leveledMember.level}.`)
    if (learnedMove) appendLog(`${leveledMember.name} learned ${learnedMove.name}!`)
    if (signatureMove) appendLog(`${leveledMember.name} learned signature move ${signatureMove.name}!`)
  }

  const applyDamage = (memberId: string, damage: number) => {
    const nextHp = Math.max(0, (partyHp[memberId] ?? 84) - damage)
    setPartyHp((current) => ({ ...current, [memberId]: Math.max(0, (current[memberId] ?? 84) - damage) }))
    if (nextHp === 0) {
      const backup = party.find((member) => member.id !== memberId && (partyHp[member.id] ?? 84) > 0)
      if (backup) {
        setActiveCompanionId(backup.id)
        appendLog(`${backup.name} takes the field!`)
      } else {
        setPhase('lost')
      }
    }
  }

  const restoreMoveUses = (memberId: string) => {
    const refill = (moves: Move[]) => moves.map((move) => ({ ...move, uses: move.maxUses }))
    if (memberId === 'pip') {
      setStarter((member) => ({ ...member, moves: refill(member.moves) }))
    } else {
      setCaptured((members) => members.map((member) => member.id === memberId ? { ...member, moves: refill(member.moves) } : member))
    }
  }

  const selectCompanion = (member: PartyMember) => {
    if (member.id === activeCompanionId) {
      setPartyOpen(false)
      return
    }

    setActiveCompanionId(member.id)
    setPartyOpen(false)
    if (phase === 'battle') {
      const incoming = damageFromType(enemy.attack, enemy.element, member.element)
      applyDamage(member.id, incoming)
      appendLog(`${member.name} switched in; ${enemy.name} dealt ${incoming} damage.`)
    } else {
      appendLog(`${member.name} will lead the next encounter.`)
    }
  }

  const releaseCompanion = (member: PartyMember) => {
    if (member.id === 'pip' || member.id === activeCompanionId) return
    setCaptured((members) => members.filter((candidate) => candidate.id !== member.id))
    setPartyHp((current) => {
      const remaining = { ...current }
      delete remaining[member.id]
      return remaining
    })
    appendLog(`${member.name} was released. A party slot is open.`)
  }

  const buySupply = (supply: Supply) => {
    const item = supplyCatalog.find((entry) => entry.id === supply)
    if (!item || coins < item.price) return
    setCoins((current) => current - item.price)
    setInventory((current) => ({ ...current, [supply]: current[supply] + 1 }))
    appendLog(`${item.name} added to your bag.`)
  }

  const buyCatcher = (catcherType: CatcherType) => {
    const catcher = catcherCatalog.find((entry) => entry.id === catcherType)
    if (!catcher || catcher.price === 0 || coins < catcher.price) return
    setCoins((current) => current - catcher.price)
    setCatchers((current) => ({ ...current, [catcherType]: current[catcherType] + 1 }))
    appendLog(`${catcher.name} added to your catcher kit.`)
  }

  const applySupply = (supply: Supply) => {
    if (inventory[supply] < 1) return

    if (supply === 'potion') {
      if (playerHp >= 84) return
      setPartyHp((current) => ({ ...current, [activeCompanionId]: Math.min(84, (current[activeCompanionId] ?? 84) + 35) }))
      appendLog(`${activeCompanion.name} recovered 35 HP.`)
    } else if (supply === 'revive') {
      const fainted = party.find((member) => (partyHp[member.id] ?? 84) === 0)
      if (!fainted) return
      setPartyHp((current) => ({ ...current, [fainted.id]: 42 }))
      if (phase === 'lost') {
        setActiveCompanionId(fainted.id)
        setPhase('battle')
      }
      appendLog(`${fainted.name} returned with 42 HP.`)
    } else if (supply === 'candy') {
      levelUpCompanion(activeCompanion)
    } else {
      if (activeCompanion.moves.every((move) => move.uses === move.maxUses)) return
      restoreMoveUses(activeCompanionId)
      appendLog(`${activeCompanion.name} restored all move uses.`)
    }

    setInventory((current) => ({ ...current, [supply]: current[supply] - 1 }))
    if (phase === 'battle') {
      const incoming = damageFromType(enemy.attack, enemy.element, activeCompanion.element)
      applyDamage(activeCompanionId, incoming)
      appendLog(`${enemy.name} answered the item use for ${incoming} damage.`)
    }
  }

  const takeTurn = (action: Action) => {
    const availableCatchers = catchers.trail + catchers.swift + catchers.master
    if (phase !== 'battle' || (action === 'capture' && (availableCatchers === 0 || party.length >= MAX_PARTY_SIZE)) || (action === 'switch' && party.length < 2)) return

    if (action === 'switch') {
      setPartyOpen(true)
      return
    }

    setCatchers((current) => ({ ...current, [activeCatcher.id]: current[activeCatcher.id] - 1 }))
    if (rollChance(captureChance)) {
      const capturedId = `caught-${captureSequence.current++}`
      const caughtLevel = activeCompanion.level + stage
      const caughtMember = evolveWithSignature({
        ...enemy,
        id: capturedId,
        level: caughtLevel,
        lineage: enemy.name,
        moves: movesForLevel(enemy.name, caughtLevel),
      })
      setCaptured((roster) => [...roster, { ...enemy, ...caughtMember }])
      setPartyHp((current) => ({ ...current, [capturedId]: 84 }))
      setPhase(stage === MAX_WAVES ? 'endless' : 'caught')
      appendLog(`${enemy.name} joined your team!`)
      if (caughtMember.name !== enemy.name) appendLog(`${enemy.name} evolved into ${caughtMember.name}!`)
      return
    }

    appendLog(`${enemy.name} broke free of the field pod.`)
    const incoming = damageFromType(enemy.attack, enemy.element, activeCompanion.element)
    applyDamage(activeCompanionId, incoming)
    appendLog(`${enemy.name} answered for ${incoming} damage.`)
  }

  const resolveVictory = () => {
    setPhase(stage === MAX_WAVES ? 'endless' : 'won')
    const tierReward = enemy.tier === 'COMMON' ? 8 : enemy.tier === 'RARE' ? 14 : 24
    const coinReward = tierReward + (enemy.boss ? 6 : 0)
    setCoins((total) => total + coinReward)
    appendLog(`Earned ${coinReward} trail coins.`)
    const droppedSupply = rollMonsterDrop(enemy.tier, enemy.boss === true)
    if (droppedSupply) {
      setInventory((current) => ({ ...current, [droppedSupply]: current[droppedSupply] + 1 }))
      const droppedName = supplyCatalog.find((item) => item.id === droppedSupply)?.name ?? 'supplies'
      appendLog(`${enemy.name} dropped a ${droppedName}!`)
    }
    if (experience + EXPERIENCE_PER_WIN >= EXPERIENCE_TO_LEVEL) {
      levelUpCompanion(activeCompanion)
      setPartyHp((current) => ({ ...current, [activeCompanionId]: Math.min(84, (current[activeCompanionId] ?? 84) + 12) }))
    }
    setExperience((total) => (total + EXPERIENCE_PER_WIN) % EXPERIENCE_TO_LEVEL)
    appendLog(`${enemy.name} was driven from the trail.`)
  }

  const performMove = (move: Move) => {
    if (phase !== 'battle' || energy < move.energyCost || move.uses <= 0) return
    const spendMoveUse = (moves: Move[]) => moves.map((knownMove) => knownMove.id === move.id
      ? { ...knownMove, uses: Math.max(0, knownMove.uses - 1) }
      : knownMove)
    if (activeCompanionId === 'pip') {
      setStarter((member) => ({ ...member, moves: spendMoveUse(member.moves) }))
    } else {
      setCaptured((members) => members.map((member) => member.id === activeCompanionId
        ? { ...member, moves: spendMoveUse(member.moves) }
        : member))
    }
    const tierDamage = activeCompanion.tier === 'COMMON' ? 1 : activeCompanion.tier === 'RARE' ? 1.1 : 1.2
    const baseDamage = Math.round((move.power + Math.floor(activeCompanion.level / 2)) * tierDamage)
    const effectiveness = typeMultiplier(move.type, enemy.element)
    const damage = Math.round(baseDamage * effectiveness)
    const remainingEnemyHp = Math.max(0, enemyHp - damage)
    setEnemyHp(remainingEnemyHp)
    setEnergy(Math.min(3, energy - move.energyCost + 1))
    appendLog(`${activeCompanion.name} used ${move.name} for ${damage} damage.${typeEffectivenessNote(effectiveness)}`)

    if (remainingEnemyHp === 0) {
      resolveVictory()
      return
    }

    const incoming = damageFromType(enemy.attack, enemy.element, activeCompanion.element)
    applyDamage(activeCompanionId, incoming)
    appendLog(`${enemy.name} answered ${activeCompanion.name} for ${incoming} damage.`)
  }

  const continueRun = () => {
    const nextStage = stage + 1
    const nextEnemy = encounterFor(nextStage)
    setStage(nextStage)
    setEnemy(nextEnemy)
    setEnemyHp(nextEnemy.maxHp)
    const fullRest = stage % 5 === 0
    if (fullRest) {
      setPartyHp((current) => Object.fromEntries(Object.keys(current).map((memberId) => [memberId, 84])))
    } else {
      setPartyHp((current) => ({ ...current, [activeCompanionId]: Math.min(84, (current[activeCompanionId] ?? 84) + 18) }))
    }
    setEnergy(0)
    setCatchers((current) => ({ ...current, trail: Math.min(3, current.trail + 1) }))
    setPhase('battle')
    setLog([
      `${nextEnemy.name} steps onto the trail.`,
      fullRest ? 'Rest stop: your whole party is fully healed.' : 'A new encounter begins.',
    ])
  }

  const restartRun = () => {
    const firstEnemy = encounterFor(1)
    setStage(1)
    setPartyHp({ pip: 84 })
    setEnemy(firstEnemy)
    setEnemyHp(firstEnemy.maxHp)
    setEnergy(0)
    setExperience(28)
    setStarter(starterBase)
    setCoins(12)
    setInventory({ potion: 0, revive: 0, candy: 0, tonic: 0 })
    setCatchers({ trail: 3, swift: 0, master: 0 })
    setCaptured([])
    setActiveCompanionId('pip')
    setPhase('battle')
    setLog([`${firstEnemy.name} blocks the trail.`, 'Pip is ready. What will you do?'])
  }

  const progress = (experience / EXPERIENCE_TO_LEVEL) * 100
  const trailNode = Math.min(10, Math.ceil(stage / 10))
  const currentBiome = biomeForStage(stage)
  const stageName = stage > MAX_WAVES ? `${currentBiome.name} · ENDLESS` : currentBiome.name

  return (
    <div className="game-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Wildbound home">
          <span className="brand-mark"><Leaf size={18} strokeWidth={2.5} /></span>
          <span>WILDBOUND<span className="brand-dot">.</span></span>
        </a>
        <div className="topbar-center"><span className="live-dot" /> FIELD RUN <span className="topbar-divider">/</span> SEED 0041</div>
        <div className="topbar-right">
          <button className="shop-toggle" type="button" onClick={() => setShopOpen(true)} aria-label={`Open supply shop, ${coins} coins`}><ShoppingBag size={15} /><span>SUPPLIES</span></button>
          <button className="party-toggle" type="button" aria-expanded={partyOpen} aria-label={`Open party, ${party.length} of ${MAX_PARTY_SIZE} members`} onClick={() => setPartyOpen(true)}><Users size={15} /><span>PARTY</span><b>{party.length}/{MAX_PARTY_SIZE}</b></button>
          <span className="coin-count"><span className="coin-icon">¢</span> {coins}</span>
          <button className="icon-button guide-button" type="button" title="Field guide" aria-label="Field guide" aria-expanded={guideOpen} onClick={() => setGuideOpen((open) => !open)}><BookOpen size={17} /></button>
          {guideOpen && <div className="guide-popover"><strong>FIELD GUIDE</strong><p>Ten biomes change every five waves, each with its own wild roster. Your whole party heals at each rest stop. Wild spawns roll 75% Common, 24% Rare, and 1% Legendary from that biome’s roster. Higher tiers are stronger, harder to catch, and pay better; Legendary monsters cannot evolve. Swift Catchers add 18% chance; Master Catchers add 35% and are used first. Free moves charge 1 energy; three-energy Ultimates take three free moves to charge. Wave 100 unlocks endless mode.</p></div>}
          <div className="avatar-mark" aria-label="Trainer rank: trail scout">T<span>3</span></div>
        </div>
      </header>

      <main id="home" className="game-layout">
        <aside className="run-sidebar">
          <div className="sidebar-heading"><span>YOUR EXPEDITION</span><Map size={16} /></div>
          <div className="run-number">RUN <strong>01</strong><span className="run-status">{stage > MAX_WAVES ? 'ENDLESS' : 'IN PROGRESS'}</span></div>
          <div className="trail-map long-trail" aria-label={`Expedition map, wave ${stage} of ${stage > MAX_WAVES ? 'infinity' : MAX_WAVES}`}>
            <div className="trail-line" />
            {Array.from({ length: 10 }, (_, index) => index + 1).map((node) => (
              <div className={`trail-stop ${node < trailNode ? 'cleared' : ''} ${node === trailNode ? 'current' : ''}`} key={node}>
                <span className="trail-node">{node < trailNode ? <Leaf size={13} /> : node === 10 ? <Trophy size={13} /> : <span>{String(node).padStart(2, '0')}</span>}</span>
                <span className="trail-stop-label">{node === trailNode ? stage > MAX_WAVES ? 'ENDLESS' : stage === MAX_WAVES ? 'GOAL' : 'NOW' : node < trailNode ? 'CLEARED' : node === 10 ? 'WAVE 100' : 'AHEAD'}</span>
                {node === trailNode && <ArrowDownRight className="trail-pointer" size={14} />}
              </div>
            ))}
          </div>
          <div className="sidebar-rule" />
          <div className="sidebar-heading companion-heading"><span>ACTIVE COMPANION</span><span className="party-count">{party.length} / {MAX_PARTY_SIZE}</span></div>
          <div className="companion-row">
            <div className="companion-thumb"><CreatureArt color={activeCompanion.color} accent={activeCompanion.accent} name={activeCompanion.name} /></div>
            <div className="companion-details"><strong>{activeCompanion.name}</strong><span>{activeCompanion.species.toUpperCase()} · LV {activeCompanion.level}</span><div className="tiny-health"><i style={{ width: `${(playerHp / 84) * 100}%` }} /></div></div>
            <span className="companion-type"><CircleDot size={13} /></span>
          </div>
          {captured.length > 0 && <div className="captured-list">{captured.map((creature) => <div className={`captured-row ${activeCompanionId === creature.id ? 'is-active' : ''}`} key={creature.id}><span className="captured-mark" style={{ backgroundColor: creature.color }} /><span className="captured-details"><strong>{creature.name}</strong><small>{creature.tier} · {creature.element} · LV {creature.level}</small></span>{activeCompanionId === creature.id && <CircleDot size={14} />}</div>)}</div>}
          <div className="sidebar-tip"><Sparkles size={15} /><p><strong>TRAIL NOTE</strong><br />A good run is built one brave choice at a time.</p></div>
          <div className="sidebar-foot"><span>BUILD 0.1.0</span><span>MADE FOR THE WILD</span></div>
        </aside>

        <section className="battle-column" aria-label="Battle">
          <div className="battle-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {stageName} <span className="eyebrow-line" /></div><h1>Wild encounter<span>.</span></h1></div>
            <div className="encounter-counter"><span>WAVE</span><strong>{String(stage).padStart(2, '0')} <i>{stage > MAX_WAVES ? '/ ∞' : `/ ${MAX_WAVES}`}</i></strong></div>
          </div>

          <section className={`arena biome-${currentBiome.id} ${enemy.boss ? 'boss-arena' : ''}`} aria-label={`${enemy.name} battle arena in ${currentBiome.name}`}>
            <div className="arena-grain" />
            <div className="arena-topline"><span><span className="wild-marker" /> WILD <span className={`tier-chip tier-${enemy.tier.toLowerCase()}`}>{enemy.tier}</span>{enemy.boss && ' ELITE'}</span><span className="arena-weather">CLEAR SKIES <span>·</span> 16:42</span></div>
            <div className="arena-distance"><span>⟵  12 PACES  ⟶</span></div>
            <div className="enemy-status">
              <div className="creature-name"><span className={`element-tag element-${enemy.element.toLowerCase()}`}>{enemy.element}</span><strong>{enemy.name}</strong><span className="enemy-level">LV {activeCompanion.level + stage}</span></div>
              <span className="creature-title">{enemy.species} · {enemy.title}</span>
              <div className="health-track enemy-health"><i style={{ width: `${(enemyHp / enemy.maxHp) * 100}%` }} /></div>
              <span className="health-numeric">{enemyHp} <span>/ {enemy.maxHp} HP</span></span>
            </div>
            <div className="enemy-stage" style={{ backgroundColor: `${enemy.color}22` }}><CreatureArt enemy color={enemy.color} accent={enemy.accent} /></div>
            <div className="ground-ripple ripple-one" /><div className="ground-ripple ripple-two" />
            <div className="battle-vs">VS</div>
            <div className="player-stage"><CreatureArt color={activeCompanion.color} accent={activeCompanion.accent} name={activeCompanion.name} /></div>
            <div className="player-status">
              <div className="player-name"><span className="player-level">LV {activeCompanion.level}</span><strong>{activeCompanion.name}</strong><span className={`element-tag element-${activeCompanion.element.toLowerCase()}`}>{activeCompanion.element}</span></div>
              <span className="player-kind">{activeCompanion.species.toUpperCase()}</span>
              <div className="health-track player-health"><i style={{ width: `${(playerHp / 84) * 100}%` }} /></div>
              <span className="health-numeric">{playerHp} <span>/ 84 HP</span></span>
            </div>
            <div className="arena-caption"><span>WILDBOUND FIELD NOTES</span><span>NO. {String(stage).padStart(3, '0')}</span></div>
            {phase !== 'battle' && <div className="battle-overlay"><div className={`result-stamp ${phase}`}><span>{phase === 'endless' ? 'ENDLESS MODE UNLOCKED' : phase === 'won' ? 'ENCOUNTER CLEARED' : phase === 'caught' ? 'NEW COMPANION' : 'RUN ENDED'}</span><strong>{phase === 'endless' ? 'Wave 100 cleared. The wilds go on.' : phase === 'won' ? 'Well fought.' : phase === 'caught' ? `${enemy.name} joined the team.` : 'The trail goes quiet.'}</strong><button type="button" onClick={phase === 'lost' ? restartRun : continueRun}>{phase === 'lost' ? <><RotateCcw size={15} /> Start a new run</> : <>{phase === 'endless' ? 'Continue endlessly' : 'Continue trail'} <ArrowRight size={15} /></>}</button></div></div>}
          </section>

          <div className="battle-lower">
            <section className="action-section">
              <div className="action-heading"><div><span className="eyebrow-small">YOUR MOVE</span><h2>Choose a move</h2></div><div className="turn-controls"><span className="turn-indicator"><span /> YOUR TURN</span><span className="energy-meter" aria-label={`${energy} of 3 energy`}><strong>{energy}/3 EN</strong><span>{[0, 1, 2].map((point) => <i className={energy > point ? 'charged' : ''} key={point} />)}</span></span></div></div>
              <div className="action-grid">
                {activeCompanion.moves.map((move) => (
                  <button className={`action-card move-action element-${move.type.toLowerCase()}`} type="button" onClick={() => performMove(move)} disabled={phase !== 'battle' || energy < move.energyCost || move.uses <= 0} key={move.id}>
                    <span className="action-icon">{move.type === 'FIRE' ? <Flame size={18} /> : move.type === 'WATER' ? <Waves size={18} /> : <Leaf size={18} />}</span>
                    <span className="action-copy"><strong>{move.name}</strong><small>{move.type} · POWER {move.power}{move.energyCost === 3 ? ' · ULTIMATE' : ''}</small></span>
                    <span className="move-resources"><span className={move.uses === 0 ? 'empty-pp' : ''}>{move.uses}/{move.maxUses} PP</span><i>{move.energyCost} EN</i></span>
                  </button>
                ))}
                <button className="action-card capture-action" type="button" title="Capture odds improve as the wild creature loses health; better catchers increase your odds" onClick={() => takeTurn('capture')} disabled={phase !== 'battle' || catchers.trail + catchers.swift + catchers.master === 0 || party.length >= MAX_PARTY_SIZE}>
                  <span className="action-icon"><CircleDot size={19} /></span><span className="action-copy"><strong>Capture</strong><small>{party.length >= MAX_PARTY_SIZE ? 'Party full' : catchers.trail + catchers.swift + catchers.master === 0 ? 'Buy a catcher' : `${activeCatcher.name} · ${captureChance}% · ${catchers[activeCatcher.id]} left`}</small></span>
                </button>
                <button className="action-card switch-action" type="button" onClick={() => takeTurn('switch')} disabled={phase !== 'battle' || party.length < 2}>
                  <span className="action-icon"><ArrowLeftRight size={18} /></span><span className="action-copy"><strong>Switch</strong><small>{party.length < 2 ? 'Catch another creature' : 'Swap companion · enemy acts'}</small></span>
                </button>
              </div>
            </section>
            <aside className="battle-log">
              <div className="log-heading"><span className="eyebrow-small">FIELD REPORT</span><span className="log-live"><i /> LIVE</span></div>
              <div className="log-entries" aria-live="polite">{log.map((entry, index) => <p className={index === 0 ? 'log-current' : ''} key={`${entry}-${index}`}><span className="log-bullet">{index === 0 ? '›' : '·'}</span>{entry}</p>)}</div>
            </aside>
          </div>

          <footer className="battle-footer"><div className="xp-label"><Sparkles size={14} /><span>FIELD XP</span><strong>{experience} <i>/ {EXPERIENCE_TO_LEVEL}</i></strong></div><div className="xp-track"><i style={{ width: `${progress}%` }} /></div><span className="next-rank">NEXT LEVEL <ArrowRight size={13} /></span><span className="footer-separator" /><Heart size={14} className="heart-icon" /><span className="streak-count">{Math.max(0, stage - 1)} WIN STREAK</span></footer>
        </section>
      </main>
      {partyOpen && (
        <div className="party-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setPartyOpen(false) }}>
          <section className="party-dialog" role="dialog" aria-modal="true" aria-labelledby="party-title">
            <header className="party-dialog-top">
              <span><Users size={15} /> TRAIL ROSTER</span>
              <button className="icon-button" type="button" aria-label="Close party" onClick={() => setPartyOpen(false)}><X size={18} /></button>
            </header>
            <h2 id="party-title">Your party <span>{party.length} / {MAX_PARTY_SIZE}</span></h2>
            <p className="party-intro">{phase === 'battle' ? 'Switching gives the wild creature a turn.' : 'Choose which companion leads the next encounter.'}</p>
            <div className="party-slots">
              {Array.from({ length: MAX_PARTY_SIZE }, (_, slot) => {
                const member = party[slot]
                if (!member) {
                  return <div className="party-empty" key={`empty-${slot}`}><CircleDot size={18} /><span>SLOT {String(slot + 1).padStart(2, '0')}</span><strong>Waiting for a new friend</strong></div>
                }

                const fainted = (partyHp[member.id] ?? 84) === 0
                return (
                  <article className={`party-member ${activeCompanionId === member.id ? 'is-active' : ''} ${fainted ? 'is-fainted' : ''}`} key={member.id}>
                    <div className="party-member-art"><CreatureArt color={member.color} accent={member.accent} name={member.name} /></div>
                    <div className="party-member-info">
                      <span className="party-member-number">SLOT {String(slot + 1).padStart(2, '0')}{activeCompanionId === member.id && <i>ACTIVE</i>}</span>
                      <strong>{member.name}</strong>
                      <small>{member.tier} {member.species} · LV {member.level} · {fainted ? 'FAINTED' : `${partyHp[member.id] ?? 84} HP`}</small>
                      <button type="button" onClick={() => selectCompanion(member)} disabled={activeCompanionId === member.id || fainted}>{fainted ? 'Fainted' : activeCompanionId === member.id ? 'On the field' : phase === 'battle' ? 'Switch in' : 'Set active'}</button>
                      {member.id !== 'pip' && <button className="release-member-button" type="button" title={activeCompanionId === member.id ? 'Switch this monster out before releasing it' : `Release ${member.name}`} aria-label={`Release ${member.name}`} onClick={() => releaseCompanion(member)} disabled={activeCompanionId === member.id}><Trash2 size={13} /> Release</button>}
                    </div>
                  </article>
                )
              })}
            </div>
            <footer className="party-dialog-bottom">
              <span>Catchers: Trail {catchers.trail} · Swift {catchers.swift} · Master {catchers.master}</span>
              <button type="button" onClick={() => setPartyOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}
      {shopOpen && (
        <div className="party-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setShopOpen(false) }}>
          <section className="shop-dialog" role="dialog" aria-modal="true" aria-labelledby="shop-title">
            <header className="party-dialog-top">
              <span><ShoppingBag size={15} /> TRAIL SUPPLIES</span>
              <button className="icon-button" type="button" aria-label="Close shop" onClick={() => setShopOpen(false)}><X size={18} /></button>
            </header>
            <div className="shop-heading"><div><h2 id="shop-title">Field shop</h2><p>Stock up before the next encounter.</p></div><span className="shop-balance"><span className="coin-icon">¢</span>{coins}</span></div>
            <div className="shop-list">
              {supplyCatalog.map((item) => {
                const canUse = item.id === 'potion'
                  ? playerHp < 84
                  : item.id === 'revive'
                    ? party.some((member) => (partyHp[member.id] ?? 84) === 0)
                    : item.id === 'tonic'
                      ? activeCompanion.moves.some((move) => move.uses < move.maxUses)
                    : true
                return (
                  <article className="shop-item" key={item.id}>
                    <span className={`shop-item-icon ${item.id}`}>
                      {item.id === 'potion' ? <HeartPulse size={19} /> : item.id === 'revive' ? <RotateCcw size={19} /> : item.id === 'tonic' ? <RefreshCw size={19} /> : <Sparkles size={19} />}
                    </span>
                    <div className="shop-item-info"><span className="shop-item-stock">IN BAG · {inventory[item.id]}</span><strong>{item.name}</strong><p>{item.description}</p></div>
                    <div className="shop-item-actions">
                      <button className="use-item-button" type="button" onClick={() => applySupply(item.id)} disabled={inventory[item.id] === 0 || !canUse}>{item.id === 'revive' ? 'Revive' : item.id === 'tonic' ? 'Restore' : 'Use'}</button>
                      <button className="buy-item-button" type="button" onClick={() => buySupply(item.id)} disabled={coins < item.price}>Buy <span>{item.price}¢</span></button>
                    </div>
                  </article>
                )
              })}
            </div>
            <section className="catcher-shop">
              <header><strong>BETTER CATCHERS</strong><span>Equips automatically, best first</span></header>
              <div className="catcher-shop-list">
                {catcherCatalog.filter((catcher) => catcher.id !== 'trail').map((catcher) => (
                  <article className={`catcher-shop-item catcher-${catcher.id}`} key={catcher.id}>
                    <div><strong>{catcher.name}</strong><small>{catcher.description} · OWNED {catchers[catcher.id]}</small></div>
                    <button className="buy-item-button" type="button" onClick={() => buyCatcher(catcher.id)} disabled={coins < catcher.price}>Buy <span>{catcher.price}¢</span></button>
                  </article>
                ))}
              </div>
            </section>
            <footer className="shop-footer"><span>Items used during battle give the wild creature a turn.</span><button type="button" onClick={() => setShopOpen(false)}>Done</button></footer>
          </section>
        </div>
      )}
      <div className="page-corner page-corner-left" /><div className="page-corner page-corner-right" />
    </div>
  )
}

export default App