import { execFileSync } from 'node:child_process'
import process from 'node:process'

const platformTargetByOs = {
  linux: '--linux',
  darwin: '--mac',
  win32: '--win',
}

const targetFlag = process.env.PACKAGE_SMOKE_TARGET || platformTargetByOs[process.platform]
if (!targetFlag) {
  console.error(`Unsupported platform for package smoke: ${process.platform}`)
  process.exit(1)
}

const args = ['exec', 'electron-builder', '--', '--dir', '--publish', 'never', '--config.compression=store', targetFlag]
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

console.log(`Running package smoke: ${npmCommand} ${args.join(' ')}`)
execFileSync(npmCommand, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
  },
})
