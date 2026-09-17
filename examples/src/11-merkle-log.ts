/**
 * Recipe 11: a tamper-evident session log. RFC 6962 Merkle checkpoints over hash-chained
 * psi records, a signed checkpoint, an inclusion proof and a consistency proof.
 * bun examples/src/11-merkle-log.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  checkpointOf,
  checkpointText,
  ed25519VerifierKey,
  merkleTree,
  serializeCheckpoint,
  signNote,
  toHex,
  verifyChain,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
} from '@mindpeeker/ledger'
import { recordSession } from '@mindpeeker/psi'
import { openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const origin = 'example.org/mindpeeker-cookbook/session-log'
const early = size(args, 601, 61) // lines at the first published checkpoint
const total = size(args, 2001, 201) // header + trial lines at the second

// 1. Records: a hash-chained two-source psi session (one line per source per round).
const sources = [openSource(args.source, 'log-a'), openSource(args.control, 'log-b')]
const lines: string[] = []
const offline = args.source === 'offline' && args.control === 'offline'
for await (const line of recordSession(sources, {
  chain: true,
  now: offline ? () => Date.UTC(2026, 8, 17) + lines.length : Date.now,
})) {
  lines.push(line)
  if (lines.length === total) break
}

// 2. Two checkpoints of the same growing log; the log operator signs the newer one.
const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
  'sign',
  'verify',
])) as CryptoKeyPair
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
const signer = { name: 'cookbook-log', privateKey: keys.privateKey, publicKey }
const before = await checkpointOf(origin, lines.slice(0, early))
const after = await checkpointOf(origin, lines)
const signed = serializeCheckpoint(after, [await signNote(checkpointText(after), signer)])
const verifierKey = await ed25519VerifierKey(signer.name, publicKey)
const status = await verifyCheckpoint(signed, [verifierKey], { origin })
console.log('checkpoint sizes   ', before.size, '→', after.size)
console.log('signed checkpoint  ', status.status, `root ${toHex(after.root).slice(0, 16)}…`)

// 3. Inclusion: one line, one O(log n) proof, checked against the signed root.
const tree = await merkleTree(lines)
const index = Math.floor(total / 2)
const proof = tree.inclusionProof(index)
const line = lines[index] as string
console.log(
  'inclusion          ',
  await verifyInclusion(line, index, tree.size, proof, after.root),
  `(${proof.length} hashes)`,
)
const forged = line.replace(
  /"sum":(\d+)/,
  (_m, s: string) => `"sum":${Number(s) === 0 ? 1 : Number(s) - 1}`,
)
console.log(
  'edited line        ',
  await verifyInclusion(forged, index, tree.size, proof, after.root),
)

// 4. Consistency: the newer tree extends the older one, so nothing published was rewritten.
const consistency = tree.consistencyProof(early)
console.log(
  'append-only        ',
  await verifyConsistency(early, tree.size, before.root, after.root, consistency),
  `(${consistency.length} hashes)`,
)
const rewritten = [...lines]
rewritten[5] = lines[6] as string // history changed before the first checkpoint
const rewrittenTree = await merkleTree(rewritten)
console.log(
  'rewritten history  ',
  await verifyConsistency(
    early,
    tree.size,
    before.root,
    rewrittenTree.root,
    rewrittenTree.consistencyProof(early),
  ),
)

// 5. The chain view of the same file: links hold, and a published head exposes truncation.
const chain = await verifyChain(lines, { format: 'psi' })
const truncated = await verifyChain(lines.slice(0, -1), { format: 'psi', head: chain.head })
console.log('hash chain         ', chain.ok, `head ${chain.head?.slice(0, 16)}…`)
console.log('truncated file     ', truncated.ok, truncated.failure)
