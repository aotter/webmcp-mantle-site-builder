import { cp, readFile, rm, writeFile } from 'node:fs/promises'

const source = new URL('../node_modules/@aotter/mantle-admin-ui/dist/', import.meta.url)
const destination = new URL('../public/_mantle/admin/', import.meta.url)
const manifestReference = new URL('../node_modules/@aotter/mantle/docs/design-atoms.md', import.meta.url)
const publicManifestReference = new URL('../public/_mantle/design-atoms.md', import.meta.url)

await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
await cp(manifestReference, publicManifestReference)

const index = new URL('index.html', destination)
const html = await readFile(index, 'utf8')
await writeFile(index, html.replace('</head>', '    <script src="/admin-host-bridge.js"></script>\n  </head>'))
