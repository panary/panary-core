import { TestBed } from '@angular/core/testing'
import { App } from './app'
import { TranslateModule } from '@ngx-translate/core'

describe('App', () => {
  beforeEach(async () => {
    // Node 25+ bringt ein eigenes globales `localStorage` mit, das ohne --localstorage-file
    // kein getItem hat und das von jsdom überdeckt — daher explizit ersetzen.
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    })
    await TestBed.configureTestingModule({
      imports: [App, TranslateModule.forRoot()],
    }).compileComponents()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should create the app', async () => {
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    expect(fixture.componentInstance).toBeTruthy()
  })
})
