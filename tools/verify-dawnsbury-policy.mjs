// Local-only oracle: compile the ACTUAL decompiled comparer and attack evaluator
// with minimal data stubs, then compare them with our JavaScript reconstruction.
// Does not load the game assembly. Raw decompiled files stay in ignored .scratch.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attackValue, compareOptions, priorityLayer, standardArmorClass, tileDistance } from '../src/dawnsbury/chooser.mjs';

const root = new URL('../', import.meta.url), scratch = new URL('.scratch/dawnsbury-oracle/', root);
const source = new URL('.scratch/dawnsbury-decompiled/', root);
const assemblyPath = process.argv[2] ?? 'G:/SteamLibrary/steamapps/common/Dawnsbury Days/Data/Dawnsbury Days.dll';
const assemblySha256 = createHash('sha256').update(await readFile(assemblyPath)).digest('hex');
if (assemblySha256 !== '61d48e6c059777a74b17e0fe4d9bc6600d57fbf6a09fe78e47cfdb7272304b23') {
  throw new Error('The game assembly has changed; review the recovered behavior and provenance before verifying this version.');
}
await mkdir(scratch, { recursive: true });
const readType = name => readFile(new URL(`${name}.decompiled.cs`, source), 'utf8');
const [comparer, ai, constants, tile] = await Promise.all([
  readType('Dawnsbury.Core.Intelligence.AIUsefulnessComparer'),
  readType('Dawnsbury.Core.Intelligence.AI'), readType('Dawnsbury.Constants'), readType('Dawnsbury.Core.Tiles.Tile'),
]);
function method(text, signature) {
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`Missing decompiled member: ${signature}`);
  const open = text.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < text.length) { if (text[end] === '{') depth++; if (text[end] === '}') depth--; end++; }
  if (depth) throw new Error('Unbalanced decompiled method');
  return text.slice(start, end);
}
const attack = method(ai, 'public float DealDamageWithAttack(');
const ac = method(constants, 'public static int GetStandardACPerLevel(');
const distance = method(tile, 'public int DistanceTo(Tile anotherTile)');
await writeFile(new URL('OriginalComparer.cs', scratch), comparer);
await writeFile(new URL('OriginalMethods.cs', scratch), `
using Dawnsbury.Core.Creatures;
using Dawnsbury.Core.CombatActions;
using Dawnsbury.Core.Mechanics.Rules;
namespace Dawnsbury { public static class Constants { ${ac} } }
namespace Dawnsbury.Core.Tiles { public class Tile { public int X, Y; ${distance} } }
namespace Dawnsbury.Core.Intelligence {
  public enum Tactic { Standard, Mindless, PackAttack }
  public class AI {
    public Creature Self = new(); public Tactic Tactic;
    public float DealDamage(Creature target, float value, CombatAction action) => value;
    ${attack}
  }
}`);
await writeFile(new URL('Stubs.cs', scratch), `
namespace Dawnsbury.Core.Mechanics.Enumerations { public enum Trait { Reach } }
namespace Dawnsbury.Core.CombatActions { public class CombatAction {} }
namespace Dawnsbury.Core.Mechanics.Rules {
  public static class HiddenRules {
    public static int? DetermineConcealmentCheckDC(Dawnsbury.Core.CombatActions.CombatAction a, Dawnsbury.Core.Creatures.Creature c) => c.ConcealmentDC;
  }
}
namespace Dawnsbury.Core.Creatures {
  public class Iteration { public int NearestEnemyIsThisManySquaresAway; }
  public class Tile { public Iteration InIteration = new(); }
  public class Space { public int NaturalReach; public Tile TopLeftTile = new(); }
  public class Encounter { public int CharacterLevel; }
  public class Battle { public Encounter Encounter = new(); }
  public class Neighbourhood { public System.Collections.Generic.List<Creature> Creatures = new(); }
  public class Creature {
    public Space Space = new(); public Battle Battle = new(); public Neighbourhood Neighbours = new();
    public int? ConcealmentDC; public bool ReachWeapon;
    public bool WieldsItem(Dawnsbury.Core.Mechanics.Enumerations.Trait trait) => ReachWeapon;
    public bool FriendOf(Creature other) => true;
  }
}
namespace Dawnsbury.Core.Intelligence {
  public class AIUsefulness {
    public float MainActionUsefulness;
    public bool RequiresMovement, YouStillHaveGoodAttacksLeft, IsShift;
    public int DistanceFromYou, DistanceFromClosestEnemy;
    public Dawnsbury.Core.Creatures.Creature? ForWhom;
  }
}`);
await writeFile(new URL('Oracle.csproj', scratch), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>`);
await writeFile(new URL('Program.cs', scratch), `
using System.Text.Json;
using Dawnsbury.Core.Intelligence;
using Dawnsbury.Core.Creatures;
AIUsefulness Parse(JsonElement e) {
  var v = new AIUsefulness {
    MainActionUsefulness = e.GetProperty("value").GetSingle(), RequiresMovement = e.GetProperty("movement").GetBoolean(),
    YouStillHaveGoodAttacksLeft = e.GetProperty("goodAttacksLeft").GetBoolean(), IsShift = e.GetProperty("step").GetBoolean(),
    DistanceFromYou = e.GetProperty("distanceMoved").GetInt32(), DistanceFromClosestEnemy = e.GetProperty("nearestEnemy").GetInt32()
  };
  if (e.TryGetProperty("currentNearestEnemy", out var distance)) {
    v.ForWhom = new Creature(); v.ForWhom.Space.TopLeftTile.InIteration.NearestEnemyIsThisManySquaresAway = distance.GetInt32();
    v.ForWhom.Space.NaturalReach = e.GetProperty("reachSquares").GetInt32();
  }
  return v;
}
var input = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement;
var comparer = new AIUsefulnessComparer();
var ranking = input.GetProperty("ranking").EnumerateArray().Select(row => {
  var a = Parse(row.GetProperty("a")); var b = Parse(row.GetProperty("b"));
  return new { layerA = AIUsefulnessComparer.GetLayer(a), layerB = AIUsefulnessComparer.GetLayer(b), comparison = Math.Sign(comparer.Compare(a, b)) };
}).ToArray();
var attacks = input.GetProperty("attacks").EnumerateArray().Select(row => {
  var ai = new AI(); ai.Self.Battle.Encounter.CharacterLevel = row.GetProperty("level").GetInt32();
  ai.Tactic = row.GetProperty("mindless").GetBoolean() ? Tactic.Mindless : row.GetProperty("packTactic").GetBoolean() ? Tactic.PackAttack : Tactic.Standard;
  var target = new Creature();
  target.ConcealmentDC = row.TryGetProperty("concealmentDC", out var dc) ? dc.GetInt32() : null;
  for (int i = 0; i <= row.GetProperty("alliesInReach").GetInt32(); i++) target.Neighbours.Creatures.Add(new Creature());
  return ai.DealDamageWithAttack(new(), row.GetProperty("bonus").GetInt32(), row.GetProperty("defenseAdjustment").GetInt32(), target, row.GetProperty("damage").GetSingle());
}).ToArray();
var distances = input.GetProperty("distances").EnumerateArray().Select(row => {
  var a = row.GetProperty("a"); var b = row.GetProperty("b");
  return new Dawnsbury.Core.Tiles.Tile { X = a.GetProperty("x").GetInt32(), Y = a.GetProperty("y").GetInt32() }
    .DistanceTo(new Dawnsbury.Core.Tiles.Tile { X = b.GetProperty("x").GetInt32(), Y = b.GetProperty("y").GetInt32() });
}).ToArray();
File.WriteAllText(args[1], JsonSerializer.Serialize(new { ranking, attacks, distances }));
`);
let seed = 0x44da2026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; }
const integer = (a, b) => a + Math.floor(random() * (b - a + 1));
const values = [-2147483648, -1338, -1337.5, -1337, -1336.5, -1336, -1, 0, 0, 0, 1, 2.5, 4999, 5000, 1073741824];
function assessment() {
  const result = { value: values[integer(0, values.length - 1)], movement: random() < 0.5, goodAttacksLeft: random() < 0.5,
    distanceMoved: integer(0, 10), nearestEnemy: integer(0, 20), step: random() < 0.5 };
  if (random() < 0.8) Object.assign(result, { currentNearestEnemy: integer(0, 20), reachSquares: integer(1, 3) });
  return result;
}
const ranking = Array.from({ length: 6000 }, () => ({ a: assessment(), b: assessment() }));
// Force comparator ties to exercise each successive tie-breaker more frequently.
for (let i = 0; i < 2000; i++) {
  const a = assessment(), b = { ...a, distanceMoved: integer(0, 10), nearestEnemy: integer(0, 20), step: random() < 0.5 };
  ranking.push({ a, b });
}
const attacks = Array.from({ length: 2000 }, () => {
  const level = integer(-1, 20);
  const result = { level, referenceAC: standardArmorClass(level), bonus: integer(-15, 45), damage: integer(1, 100) / 2,
    defenseAdjustment: integer(-4, 4), alliesInReach: integer(0, 4), packTactic: random() < 0.5, mindless: random() < 0.2 };
  if (random() < 0.3) result.concealmentDC = random() < 0.5 ? 5 : 11;
  return result;
});
const distances = Array.from({ length: 1000 }, () => ({ a: { x: integer(-30, 30), y: integer(-30, 30) }, b: { x: integer(-30, 30), y: integer(-30, 30) } }));
const input = JSON.stringify({ ranking, attacks, distances });
await writeFile(new URL('input.json', scratch), input);
const result = spawnSync('dotnet', ['run', '--project', fileURLToPath(new URL('Oracle.csproj', scratch)), '--',
  fileURLToPath(new URL('input.json', scratch)), fileURLToPath(new URL('output.json', scratch))], {
  cwd: fileURLToPath(root), encoding: 'utf8', timeout: 120000,
  env: { ...process.env, DOTNET_CLI_HOME: fileURLToPath(new URL('.scratch/dotnet-home/', root)), DOTNET_NOLOGO: '1' },
});
if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
const oracle = JSON.parse(await readFile(new URL('output.json', scratch)));
let mismatches = 0;
ranking.forEach(({ a, b }, i) => {
  const actual = { layerA: priorityLayer(a), layerB: priorityLayer(b), comparison: Math.sign(compareOptions(a, b)) };
  if (JSON.stringify(actual) !== JSON.stringify(oracle.ranking[i])) {
    if (mismatches++ < 3) console.error({ i, a, b, actual, expected: oracle.ranking[i] });
  }
});
// JSON serializers round Single values differently; recover the original float.
attacks.forEach((row, i) => {
  if (attackValue(row) !== Math.fround(oracle.attacks[i])) {
    if (mismatches++ < 3) console.error({ i, row, actual: attackValue(row), expected: oracle.attacks[i] });
  }
});
distances.forEach(({ a, b }, i) => { if (tileDistance(a, b) !== oracle.distances[i]) mismatches++; });
const report = { verifiedAt: new Date().toISOString(), assemblyVersion: '4.44.0.0',
  assemblySha256,
  decompiler: 'ilspycmd 11.2.0.10050', seed: '0x44da2026',
  sourceSha256: { comparer: createHash('sha256').update(comparer).digest('hex'),
    attackMethod: createHash('sha256').update(attack).digest('hex'), acMethod: createHash('sha256').update(ac).digest('hex'),
    distanceMethod: createHash('sha256').update(distance).digest('hex') },
  inputSha256: createHash('sha256').update(input).digest('hex'),
  rankingPairs: ranking.length, attackEvaluations: attacks.length, distanceEvaluations: distances.length, mismatches,
  scope: 'Actual decompiled GetLayer/Compare and DealDamageWithAttack plus AC table and Tile.DistanceTo compiled with data stubs. DealDamage stub returns its input. Does not verify game runtime, target legality, action generation, pathfinding or Foundry execution.' };
await writeFile(new URL('research/dawnsbury-behavior-verification.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (mismatches) process.exitCode = 1;
