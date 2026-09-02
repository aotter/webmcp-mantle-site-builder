import { cp, rm } from 'node:fs/promises'

const source = new URL('../node_modules/@aotter/mantle-admin-ui/dist/', import.meta.url)
const destination = new URL('../public/_mantle/admin/', import.meta.url)

await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
