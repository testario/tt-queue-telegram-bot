import { readFileSync } from 'node:fs'

describe('runtime proxy configuration', () => {
  it('enables Node proxy support for the PM2 production process', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8')

    expect(workflow).toMatch(/NODE_USE_ENV_PROXY=1.*pm2 start/)
  })
})
