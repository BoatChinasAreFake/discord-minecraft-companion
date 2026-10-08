import {
  BLOCKED_COMMANDS,
  sanitizeMinecraftMessage,
  assertAllowedMinecraftChat,
  isPrivilegedCommand,
  PrivilegedCommandError
} from '../../../dist/minecraft/fairplay/commandSanitizer.js';

let passedChecks = 0;
let totalChecks = 0;
const failures = [];

function check(desc, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
  } else {
    failures.push({ desc, details });
    console.error(`FAILED: ${desc} ${details}`);
  }
}

console.log('--- Starting Empirical Forensic Audit on commandSanitizer.ts ---');

// 1. Verify BLOCKED_COMMANDS completeness and normalization
check('BLOCKED_COMMANDS is a Set', BLOCKED_COMMANDS instanceof Set);
check('BLOCKED_COMMANDS count >= 100', BLOCKED_COMMANDS.size >= 100, `Found ${BLOCKED_COMMANDS.size}`);

for (const cmd of BLOCKED_COMMANDS) {
  check(`BLOCKED_COMMANDS contains lowercase "${cmd}"`, cmd === cmd.toLowerCase() && !cmd.includes(' '));
}

// 2. Test every single BLOCKED_COMMAND with 10 attack mutations
console.log(`Auditing ${BLOCKED_COMMANDS.size} blocked commands across 10 mutation vectors...`);
for (const cmd of BLOCKED_COMMANDS) {
  // Vector A: Bare
  check(`Bare /${cmd} blocked`, isPrivilegedCommand(`/${cmd}`));
  // Vector B: With args
  check(`Args /${cmd} @p 1 blocked`, isPrivilegedCommand(`/${cmd} @p 1`));
  // Vector C: Uppercase
  check(`Uppercase /${cmd.toUpperCase()} blocked`, isPrivilegedCommand(`/${cmd.toUpperCase()}`));
  // Vector D: Mixed case
  const mixed = cmd.length > 1 ? cmd[0].toUpperCase() + cmd.slice(1) : cmd.toUpperCase();
  check(`Mixed case /${mixed} blocked`, isPrivilegedCommand(`/${mixed}`));
  // Vector E: Namespace minecraft:
  check(`Namespace /minecraft:${cmd} blocked`, isPrivilegedCommand(`/minecraft:${cmd}`));
  // Vector F: Spaced namespace /minecraft: cmd
  check(`Spaced namespace /minecraft: ${cmd} blocked`, isPrivilegedCommand(`/minecraft: ${cmd}`));
  // Vector G: Multi-space namespace /minecraft:   cmd
  check(`Multi-space namespace /minecraft:   ${cmd} blocked`, isPrivilegedCommand(`/minecraft:   ${cmd}`));
  // Vector H: Space before colon /minecraft :cmd
  check(`Space before colon /minecraft :${cmd} blocked`, isPrivilegedCommand(`/minecraft :${cmd}`));
  // Vector I: Multiline injection
  check(`Multiline injection \\n/${cmd} blocked`, isPrivilegedCommand(`Hello world\n/${cmd}`));
  // Vector J: Chained semicolon
  check(`Semicolon chain ; /${cmd} blocked`, isPrivilegedCommand(`/tell alice hi; /${cmd}`));
}

// 3. Test zero-width evasion against sample of critical commands
const sampleCritical = ['tp', 'give', 'gamemode', 'op', 'kill', 'stop', 'clear', 'spectate', 'datapack'];
for (const cmd of sampleCritical) {
  check(`Zero-width space /\\u200B${cmd} blocked`, isPrivilegedCommand(`/\u200B${cmd}`));
  check(`BOM /\\uFEFF${cmd} blocked`, isPrivilegedCommand(`/\uFEFF${cmd}`));
  if (cmd.length > 2) {
    const interspersed = cmd[0] + '\u200C' + cmd.slice(1);
    check(`Interspersed zero-width /${cmd} blocked`, isPrivilegedCommand(`/${interspersed}`));
  }
}

// 4. Test Malformed commands
const malformedTests = [
  '/',
  '//',
  '///',
  '/:',
  '/::',
  '/  ',
  '/ \t ',
  '/  gamemode',
  '/\tgamemode',
  '/\u00A0tp',
  '/minecraft:',
  '/minecraft:  ',
  '/minecraft:???',
  '/???',
  '/$'
];
for (const m of malformedTests) {
  const res = sanitizeMinecraftMessage(m);
  check(`Malformed "${m}" isCommand === true`, res.isCommand === true);
  check(`Malformed "${m}" allowed === false`, res.allowed === false);
  check(`Malformed "${m}" isPrivilegedCommand === true`, isPrivilegedCommand(m) === true);
  let threw = false;
  try {
    assertAllowedMinecraftChat(m);
  } catch (err) {
    if (err instanceof PrivilegedCommandError) threw = true;
  }
  check(`Malformed "${m}" throws PrivilegedCommandError`, threw);
}

// 5. Test Permitted survival commands and non-command chat
const permittedCommands = [
  '/tell alice hello',
  '/msg bob what is up',
  '/help',
  '/help 2',
  '/trigger counter add 1',
  '/me sits down'
];
for (const p of permittedCommands) {
  const res = sanitizeMinecraftMessage(p);
  check(`Permitted command "${p}" isCommand === true`, res.isCommand === true);
  check(`Permitted command "${p}" allowed === true`, res.allowed === true);
  check(`Permitted command "${p}" isPrivilegedCommand === false`, isPrivilegedCommand(p) === false);
  let threw = false;
  try {
    const text = assertAllowedMinecraftChat(p);
    check(`assertAllowedMinecraftChat("${p}") returns cleanedText`, typeof text === 'string');
  } catch (e) {
    threw = true;
  }
  check(`Permitted command "${p}" does not throw`, !threw);
}

const normalChats = [
  'Hello world!',
  'Why is /tp not working here?',
  'The admin said: "/give is forbidden"',
  'Line 1\nLine 2\nLine 3',
  'Building a base at x=100, z=200',
  '1/2 is half',
  'Smile :) / :D'
];
for (const c of normalChats) {
  const res = sanitizeMinecraftMessage(c);
  check(`Normal chat "${c}" isCommand === false`, res.isCommand === false);
  check(`Normal chat "${c}" allowed === true`, res.allowed === true);
  check(`Normal chat "${c}" isPrivilegedCommand === false`, isPrivilegedCommand(c) === false);
}

// 6. Test Edge types and boundary conditions
check('Empty string handled safely', !isPrivilegedCommand(''));
check('Whitespace only handled safely', !isPrivilegedCommand('   \t\n  '));
check('Null handled safely', !isPrivilegedCommand(null));
check('Undefined handled safely', !isPrivilegedCommand(undefined));
check('Number handled safely', !isPrivilegedCommand(12345));

// 7. ReDoS Stress test: ensure no catastrophic regex backtracking
const t0 = Date.now();
const evilInput1 = '/' + 'a'.repeat(2000) + ':' + 'b'.repeat(2000);
sanitizeMinecraftMessage(evilInput1);
const t1 = Date.now();
check('ReDoS test 1 (long namespace & cmd) completes in < 100ms', (t1 - t0) < 100, `Took ${t1 - t0}ms`);

const t2 = Date.now();
const evilInput2 = '/' + ' '.repeat(2000) + 'tp';
sanitizeMinecraftMessage(evilInput2);
const t3 = Date.now();
check('ReDoS test 2 (long spaces) completes in < 100ms', (t3 - t2) < 100, `Took ${t3 - t2}ms`);

const t4 = Date.now();
const evilInput3 = '///'.repeat(1000) + 'give';
sanitizeMinecraftMessage(evilInput3);
const t5 = Date.now();
check('ReDoS test 3 (repeated slashes) completes in < 100ms', (t5 - t4) < 100, `Took ${t5 - t4}ms`);

// 8. Chained attack with 100 allowed commands followed by 1 OP command
let chain = '';
for (let i = 0; i < 50; i++) {
  chain += `/tell user${i} hi; `;
}
chain += '/tp 0 0 0';
check('50 chained safe commands + 1 OP command is blocked', isPrivilegedCommand(chain));

console.log(`\nAudit finished: ${passedChecks} / ${totalChecks} checks passed.`);
if (failures.length > 0) {
  console.error(`Total failures: ${failures.length}`);
  process.exit(1);
} else {
  console.log('ALL EMPIRICAL CHECKS PASSED WITH ZERO FAILURES.');
  process.exit(0);
}
