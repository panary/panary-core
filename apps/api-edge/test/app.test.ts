// For more information about this file see https://dove.feathersjs.com/guides/cli/app.test.html
import assert from 'assert'
import axios from 'axios'
import { app } from '../src/app'

const port = app.get('port')
const appUrl = `http://${app.get('host')}:${port}`

describe('Feathers application tests', () => {
  beforeAll(async () => {
    await app.listen(port)
  })

  afterAll(async () => {
    await app.teardown()
  })

  // Der Root-Pfad liefert die Panary-Status-Page (siehe app.ts), nicht mehr die
  // Feathers-Scaffold-Indexseite.
  it('starts and shows the status page', async () => {
    const { data } = await axios.get<string>(appUrl)

    assert.ok(data.indexOf('<html lang="de">') !== -1)
    assert.ok(data.indexOf('Panary Core API') !== -1)
  })

  it('shows a 404 JSON error', async () => {
    try {
      await axios.get(`${appUrl}/path/to/nowhere`, {
        responseType: 'json',
      })
      assert.fail('should never get here')
    } catch (error) {
      assert.ok(axios.isAxiosError(error))
      const { response } = error
      assert.strictEqual(response?.status, 404)
      assert.strictEqual(response?.data?.code, 404)
      assert.strictEqual(response?.data?.name, 'NotFound')
    }
  })
})
