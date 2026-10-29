import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { cloudbaseConfig, createCloudbaseListener } from './cloudbaseServer.ts'

const listener = createCloudbaseListener(fileURLToPath(new URL('../public/', import.meta.url)), cloudbaseConfig(process.env))
const server = createServer((request, response) => { void listener(request, response) })
server.requestTimeout = 75000
server.headersTimeout = 15000
server.listen(9000, '0.0.0.0', () => { console.log('JobSense CloudBase HTTP service ready on port 9000.') })
